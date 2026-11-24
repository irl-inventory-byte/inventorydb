import { gzipSync, gunzipSync } from "zlib";
import { TABS, type Row, type TabName } from "../schema";
import type { DeleteItemResult, TableBackend } from "./backend";

/**
 * Supabase backend: the same tables and columns as the Google Sheet tabs (see supabase/setup.sql),
 * reached through Supabase's REST API with plain fetch, so no extra package is needed.
 *
 * Every table has a hidden `_seq` column that numbers rows in the order they were added. Reads are
 * sorted by it, so "oldest first" works exactly like rows in a sheet.
 *
 * Use the SECRET key (service_role, or a new-style sb_secret_… key) on the server only. Never send it
 * to the browser.
 */
export interface SupabaseConfig {
  url: string; // https://<project>.supabase.co
  key: string; // service_role / secret key
}

const PAGE = 1000; // Supabase returns at most 1000 rows per request
const CHUNK = 500; // rows per write request
const EVENT_ID_CHUNK = 150; // ids per getEventsByIds request — keeps the "in.(...)" URL well under length limits
const PARALLEL = 6; // page requests at the same time when reading a big table — lowered from 16;
// that many simultaneous connections was likely exceeding Supabase's connection limit and causing
// the ECONNRESET failures seen on the 294K-row events full download.
// Events only ever grow (a send or receive adds rows), so after one full download only the new rows are
// fetched. The whole history is downloaded again only when the row count shows rows were removed, after an
// event is edited on this server, or this often (to pick up a rare edit made on another server). Each full
// download is the history's whole size in Supabase egress, so this is kept long.
const EVENTS_FULL_MS = 12 * 60 * 60 * 1000;
// Small settings tables (logins, people, hubs): a kept copy is used for at most this long even if its change
// counter did not move, so a role or link saved on another server shows within a minute. Big tables (items)
// rely on the change counter only, so they are not downloaded again every minute.
const KEEP_MAX_MS = 60 * 1000;
const SMALL_TABLES = new Set<string>(["users", "people", "hubs"]);
const VERSIONS_MS = 1000; // reads within this time share one check of the change counters

const tabs = Object.keys(TABS) as TabName[];

export class SupabaseBackend implements TableBackend {
  private base: string;

  constructor(private cfg: SupabaseConfig) {
    this.base = `${cfg.url.replace(/\/+$/, "")}/rest/v1`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      apikey: this.cfg.key,
      "Content-Type": "application/json",
      // Ask for compressed answers: big reads (the event history) are several times smaller on the wire.
      "Accept-Encoding": "gzip",
      ...extra,
    };
    // Old-style keys are JWTs and also go in Authorization. New sb_secret_ keys work from apikey alone.
    if (this.cfg.key.startsWith("eyJ")) h.Authorization = `Bearer ${this.cfg.key}`;
    return h;
  }

  private async call(
    method: "GET" | "POST" | "DELETE",
    tab: TabName | "table_versions" | "events_cache",
    query: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Response> {
    const attempt = async () => {
      const res = await fetch(`${this.base}/${tab}?${query}`, {
        method,
        headers: this.headers(extra),
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Supabase ${method} ${tab} failed (${res.status}): ${text.slice(0, 500)}`);
      }
      return res;
    };
    // GETs have no side effects, so they're safe to retry. A transient blip (e.g. ECONNRESET, which
    // showed up under the heavy parallel load of a full events download) would otherwise throw and
    // crash the whole page instead of just trying again.
    if (method !== "GET") return attempt();
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        return await attempt();
      } catch (err) {
        lastErr = err;
        if (i < 2) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
    throw lastErr;
  }

  /** Every column of the tab as text, nothing else (the REST API needs the same keys in every row). */
  private clean(tab: TabName, rows: Row[]): Row[] {
    const columns = TABS[tab];
    return rows.map((r) => {
      const out: Row = {};
      for (const c of columns) out[c] = r[c] === undefined || r[c] === null ? "" : String(r[c]);
      return out;
    });
  }

  /** The tables are created once with supabase/setup.sql. This only checks they are there. */
  async ensureTabs() {
    const missing: string[] = [];
    for (const tab of tabs) {
      try {
        await this.call("GET", tab, `select=${TABS[tab][0]}&limit=1`);
      } catch {
        missing.push(tab);
      }
    }
    if (missing.length) {
      throw new Error(
        `Supabase is missing these tables: ${missing.join(", ")}. Run supabase/setup.sql in the Supabase SQL Editor.`,
      );
    }
  }

  // ---- copies of tables kept between requests --------------------------------------------------
  // A table is downloaded again only when its change counter (table_versions, kept by triggers in
  // setup.sql) moved. Without that table (setup.sql not run again yet) nothing is kept: same as before.

  private kept = new Map<TabName, { v: string; rows: Row[]; at: number }>();
  private versions: { at: number; map: Promise<Map<string, string> | null> } | null = null;

  /** The change counters, shared by all reads in the same moment (one small request per page). */
  private readVersions(): Promise<Map<string, string> | null> {
    if (this.versions && Date.now() - this.versions.at < VERSIONS_MS) return this.versions.map;
    const map = this.call("GET", "table_versions", "select=tab,v")
      .then(async (res) => {
        const list = (await res.json()) as { tab: string; v: number | string }[];
        return new Map(list.map((x) => [x.tab, String(x.v)]));
      })
      .catch(() => null); // no counters table: just read everything as before
    this.versions = { at: Date.now(), map };
    return map;
  }

  /**
   * Forget kept copies (and the counters) so the next read cannot miss a write. `edited` = rows were changed
   * or removed (not only added): kept events are then downloaded again in full. Added events need no full
   * download: the next read fetches the new rows, so a send or receive does not reload the whole history.
   */
  private forget(tabs: TabName[], edited: boolean) {
    for (const t of tabs) this.kept.delete(t);
    if (edited && tabs.includes("events")) this.events = this.events && { ...this.events, at: 0 };
    this.versions = null;
  }

  /** Run a write; forget before AND after, so the page shown right after saving is fresh. */
  private async writing<T>(tabs: TabName[], fn: () => Promise<T>, edited = true): Promise<T> {
    this.forget(tabs, edited);
    try {
      return await fn();
    } finally {
      this.forget(tabs, edited);
    }
  }

  // Events: the kept copy, the highest _seq in it, and when it was fully downloaded.
  private events: { rows: Row[]; maxSeq: number; at: number } | null = null;
  private eventsRead: Promise<Row[]> | null = null;

  /**
   * Events, oldest first, without downloading the whole history each time: fetch only rows added since
   * the kept copy (_seq greater than the last one), and check the total row count at the same time.
   * If the count does not match (rows were deleted), or the copy is older than EVENTS_FULL_MS, everything
   * is downloaded again. Reads that arrive together share one request.
   */
  private readEvents(): Promise<Row[]> {
    this.eventsRead ??= this.refreshEvents().finally(() => {
      this.eventsRead = null;
    });
    return this.eventsRead;
  }

  /** Reads the shared, compressed copy of the events table that any instance may have written. */
  private async readSharedEventsCache(): Promise<{ rows: Row[]; maxSeq: number; at: number } | null> {
    const res = await this.call(
      "GET",
      "events_cache",
      "select=data_gzip_b64,max_seq,row_count,updated_at&id=eq.1&limit=1",
    );
    const rows = (await res.json()) as { data_gzip_b64: string; max_seq: number; row_count: number }[];
    const row = rows[0];
    if (!row || !row.data_gzip_b64) return null;
    const json = gunzipSync(Buffer.from(row.data_gzip_b64, "base64")).toString("utf8");
    const parsed = JSON.parse(json) as Row[];
    // Trust it only if the row count still lines up — a cheap sanity check against drift.
    if (parsed.length !== row.row_count) return null;
    return { rows: parsed, maxSeq: Number(row.max_seq), at: Date.now() };
  }

  /** Writes the current in-memory events copy back so every other instance can reuse it. */
  private async writeSharedEventsCache(events: { rows: Row[]; maxSeq: number }): Promise<void> {
    const gz = gzipSync(Buffer.from(JSON.stringify(events.rows), "utf8")).toString("base64");
    await this.call(
      "POST",
      "events_cache",
      "on_conflict=id",
      [
        {
          id: 1,
          data_gzip_b64: gz,
          max_seq: events.maxSeq,
          row_count: events.rows.length,
          updated_at: new Date().toISOString(),
        },
      ],
      { Prefer: "resolution=merge-duplicates,return=minimal" },
    );
  }

  private async refreshEvents(): Promise<Row[]> {
    // A fresh/cold instance has nothing locally yet — try the shared copy before resorting to a full
    // download of its own. This is what stops "(server start)" full downloads from happening on nearly
    // every request: instead of every instance redownloading 295K rows independently, they all share
    // one copy in Supabase itself (the events_cache table), kept current the same way below.
    if (!this.events) {
      const shared = await this.readSharedEventsCache().catch((err) => {
        console.error("[events_cache] read failed:", err);
        return null;
      });
      if (shared) this.events = shared;
    }

    const kept = this.events;
    if (kept && Date.now() - kept.at < EVENTS_FULL_MS) {
      try {
        const [added, total] = await Promise.all([this.download("events", kept.maxSeq), this.count("events")]);
        if (this.events === kept && total === kept.rows.length + added.rows.length) {
          kept.rows.push(...added.rows);
          kept.maxSeq = Math.max(kept.maxSeq, added.maxSeq);
          if (added.rows.length) {
            await this.writeSharedEventsCache(kept).catch((err) => console.error("[events_cache] write failed:", err));
          }
          return kept.rows;
        }
      } catch {
        // Fall through to a full download.
      }
    }
    const full = await this.download("events");
    this.events = { rows: full.rows, maxSeq: full.maxSeq, at: Date.now() };
    // Shows in Vercel → Logs: how often the whole history is downloaded (each one counts as egress).
    console.log(`[supabase] full events download: ${full.rows.length} rows${kept ? "" : " (server start)"}`);
    await this.writeSharedEventsCache(this.events).catch((err) => console.error("[events_cache] write failed:", err));
    return full.rows;
  }

  /**
   * Only the events with these ids (e.g. each item's last_event_id), in one small request, instead of
   * the whole events history. Checks the kept copy first — if a wanted event is already in memory (the
   * usual case once a server has been warm a little while), it's returned with no network call at all.
   * Anything still missing is fetched directly from Supabase by event_id, which is cheap and does not
   * download or keep the rest of the table.
   */
  async getEventsByIds(ids: string[]): Promise<Row[]> {
    const wantedSet = new Set(ids.filter(Boolean));
    const wanted = [...wantedSet];
    if (!wanted.length) return [];

    const found = new Map<string, Row>();
    const kept = this.events;
    if (kept) {
      for (const row of kept.rows) {
        if (wantedSet.has(row.event_id)) found.set(row.event_id, { ...row });
      }
    }

    const missing = wanted.filter((id) => !found.has(id));
    if (missing.length) {
      const columns = TABS.events;
      // A big `in.(...)` list can make the request URL too long (thousands of items → 400 Bad Request),
      // so ids are fetched in chunks — several chunks AT THE SAME TIME (like download() does for pages)
      // rather than one request per id.
      const chunks: string[][] = [];
      for (let i = 0; i < missing.length; i += EVENT_ID_CHUNK) chunks.push(missing.slice(i, i + EVENT_ID_CHUNK));

      const fetchChunk = async (chunk: string[]) => {
        // PostgREST's `in.()` list: ids are plain UUID/text, not quoted or escaped specially here.
        const select = `select=${columns.join(",")}&event_id=in.(${chunk.join(",")})`;
        const res = await this.call("GET", "events", select);
        return (await res.json()) as Record<string, unknown>[];
      };

      let next = 0;
      const results: Record<string, unknown>[][] = new Array(chunks.length);
      const worker = async () => {
        while (next < chunks.length) {
          const i = next++;
          results[i] = await fetchChunk(chunks[i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));

      for (const page of results) {
        for (const r of page) {
          const row: Row = {};
          for (const c of columns) row[c] = r[c] === null || r[c] === undefined ? "" : String(r[c]);
          found.set(row.event_id, row);
        }
      }
    }

    return wanted.map((id) => found.get(id)).filter((r): r is Row => r !== undefined);
  }

  /** Total rows in a table (one small request). */
  private async count(tab: TabName): Promise<number> {
    const res = await this.call("GET", tab, "select=_seq&limit=1", undefined, { Prefer: "count=exact" });
    const total = Number(res.headers.get("content-range")?.split("/")[1]);
    if (!Number.isFinite(total)) throw new Error("no row count");
    return total;
  }

  /** All rows, oldest first; reuses the kept copy when the table has not changed since. */
  async readAll(tab: TabName): Promise<Row[]> {
    if (tab === "events") return (await this.readEvents()).map((r) => ({ ...r }));

    // Counter BEFORE rows: a write that lands in between makes the next read fetch again.
    const map = await this.readVersions();
    if (!map) return (await this.download(tab)).rows;

    const v = map.get(tab) ?? "0"; // "0" = never written since the counters were added
    const hit = this.kept.get(tab);
    const fresh = !SMALL_TABLES.has(tab) || (hit !== undefined && Date.now() - hit.at < KEEP_MAX_MS);
    if (hit && hit.v === v && fresh) return hit.rows.map((r) => ({ ...r }));

    const { rows } = await this.download(tab);
    this.kept.set(tab, { v, rows, at: Date.now() });
    return rows.map((r) => ({ ...r }));
  }

  /**
   * All rows, oldest first. Supabase gives at most PAGE rows per request, so a big table (events) needs
   * many requests.
   *
   * These are fetched by `_seq` RANGE (`_seq=gt.lo&_seq=lte.hi`), not by `OFFSET`. OFFSET makes Postgres
   * walk and discard that many rows every single time, which gets slower the deeper a page is — at
   * ~295K rows that became slow enough to exceed Postgres's own statement timeout ("canceling statement
   * due to statement timeout") and fail outright. A `_seq` range is a direct indexed lookup instead, so
   * it's equally fast regardless of how deep into the table it starts.
   *
   * Ranges are first split evenly by VALUE across the known span of `_seq`, sized with a safety margin
   * (aiming for well under PAGE rows each) so uneven density rarely matters. If a range still comes back
   * at the row cap anyway (meaning it may hold more than we asked for), it's split in half and re-fetched
   * instead of silently dropping rows — so correctness never depends on the density guess being right,
   * only on it being a reasonable starting point.
   */
  private async download(tab: TabName, afterSeq?: number): Promise<{ rows: Row[]; maxSeq: number }> {
    const columns = TABS[tab];
    const lo0 = afterSeq ?? 0;

    const [countRes, maxRes] = await Promise.all([
      this.call("GET", tab, `select=_seq&_seq=gt.${lo0}&limit=1`, undefined, { Prefer: "count=exact" }),
      this.call("GET", tab, `select=_seq&_seq=gt.${lo0}&order=_seq.desc&limit=1`),
    ]);
    const total = Number(countRes.headers.get("content-range")?.split("/")[1]);
    const maxRow = ((await maxRes.json()) as { _seq: number | string }[])[0];
    const hi0 = maxRow ? Number(maxRow._seq) : lo0;

    let maxSeq = lo0;
    const toRows = (page: Record<string, unknown>[]): Row[] =>
      page.map((r) => {
        const row: Row = {};
        for (const c of columns) row[c] = r[c] === null || r[c] === undefined ? "" : String(r[c]);
        const seq = Number(r._seq);
        if (seq > maxSeq) maxSeq = seq;
        return row;
      });

    if (!Number.isFinite(total) || total <= 0 || hi0 <= lo0) return { rows: [], maxSeq };

    const fetchRange = async (lo: number, hi: number) => {
      const res = await this.call(
        "GET",
        tab,
        `select=${columns.join(",")},_seq&_seq=gt.${lo}&_seq=lte.${hi}&order=_seq.asc&limit=${PAGE}`,
      );
      const page = (await res.json()) as Record<string, unknown>[];
      return { page, truncated: page.length >= PAGE };
    };

    // Safety margin: twice as many buckets as a naive total/PAGE split, so an uneven spread of rows
    // across the range rarely trips the split-and-retry path below.
    const bucketCount = Math.max(1, Math.ceil(total / (PAGE / 2)));
    const span = hi0 - lo0;
    const initial: [number, number][] = [];
    for (let i = 0; i < bucketCount; i++) {
      const lo = lo0 + Math.floor((span * i) / bucketCount);
      const hi = i === bucketCount - 1 ? hi0 : lo0 + Math.floor((span * (i + 1)) / bucketCount);
      if (hi > lo) initial.push([lo, hi]);
    }

    const pages: Record<string, unknown>[][] = [];
    const pending = initial;
    while (pending.length) {
      const batch = pending.splice(0, PARALLEL);
      const results = await Promise.all(batch.map(([lo, hi]) => fetchRange(lo, hi)));
      results.forEach((result, i) => {
        const [lo, hi] = batch[i];
        if (result.truncated && hi - lo > 1) {
          // This range hit the row cap — it may hold more rows than fit in one response. Split it and
          // retry both halves rather than silently losing whatever didn't fit.
          const mid = lo + Math.floor((hi - lo) / 2);
          pending.push([lo, mid], [mid, hi]);
        } else {
          pages.push(result.page);
        }
      });
    }

    const rows = pages.flatMap(toRows);
    return { rows, maxSeq };
  }

  async append(tab: TabName, rows: Row[]) {
    await this.writing(
      [tab],
      async () => {
        const clean = this.clean(tab, rows);
        for (let i = 0; i < clean.length; i += CHUNK) {
          await this.call("POST", tab, "", clean.slice(i, i + CHUNK), { Prefer: "return=minimal" });
        }
      },
      false, // rows only added
    );
  }

  /** Update rows whose key exists, add the rest. Existing rows keep their place in the order. */
  async upsert(tab: TabName, rows: Row[]) {
    await this.writing([tab], () => this.upsertNow(tab, rows));
  }

  private async upsertNow(tab: TabName, rows: Row[]) {
    const key = TABS[tab][0];
    // The same key twice in one request is refused by Postgres, so the last one wins (like the sheet).
    const byKey = new Map<string, Row>();
    for (const r of this.clean(tab, rows)) {
      byKey.delete(r[key]);
      byKey.set(r[key], r);
    }
    const list = [...byKey.values()];
    for (let i = 0; i < list.length; i += CHUNK) {
      await this.call("POST", tab, `on_conflict=${key}`, list.slice(i, i + CHUNK), {
        Prefer: "resolution=merge-duplicates,return=minimal",
      });
    }
  }

  /**
   * Delete one row from a tab by its key column (e.g. note_id for delay_notes). Clears any kept copy of
   * that tab so the next read doesn't still show the deleted row.
   */
  async deleteRow(tab: TabName, id: string): Promise<void> {
    const trimmed = id.trim();
    if (!trimmed) return;
    const key = TABS[tab][0];
    await this.writing([tab], async () => {
      await this.call("DELETE", tab, `${key}=eq.${encodeURIComponent(trimmed)}`, undefined, { Prefer: "return=minimal" });
    });
  }

  /** Permanent deletion of one item and its history. The calling server action checks it is an admin. */
  async deleteItemAndHistory(itemId: string): Promise<DeleteItemResult> {
    if (!itemId.trim()) throw new Error("An item ID is required.");
    // "items" only, not "events": deleteNow() below patches the kept events copy itself (removing
    // exactly the rows it deleted) instead of invalidating it, so a delete here no longer forces a
    // full 294K-row re-download of the events table on the very next read.
    return this.writing(["items"], () => this.deleteNow(itemId));
  }

  private async deleteNow(itemId: string): Promise<DeleteItemResult> {
    const id = encodeURIComponent(itemId);
    const found = await this.call("GET", "items", `item_id=eq.${id}&select=item_id`);
    if (((await found.json()) as unknown[]).length === 0) {
      throw new Error("Item not found. Nothing was deleted.");
    }
    const ev = await this.call("DELETE", "events", `item_id=eq.${id}&select=event_id`, undefined, {
      Prefer: "return=representation",
    });
    const deletedEventRows = (await ev.json()) as { event_id: string }[];
    const deletedEvents = deletedEventRows.length;
    const it = await this.call("DELETE", "items", `item_id=eq.${id}&select=item_id`, undefined, {
      Prefer: "return=representation",
    });
    const deletedItems = ((await it.json()) as unknown[]).length;

    // Patch the kept events copy in place instead of throwing it away: remove exactly the rows that
    // were just deleted, so the next read's incremental check (kept rows + newly added rows == total
    // count) still lines up and doesn't fall back to a full re-download. See refreshEvents() above.
    // Also write that correction to the shared copy, so other instances get the same fix immediately
    // instead of hitting the mismatch themselves and triggering their own full re-download.
    if (this.events && deletedEventRows.length) {
      const removedIds = new Set(deletedEventRows.map((r) => r.event_id));
      this.events = { ...this.events, rows: this.events.rows.filter((r) => !removedIds.has(r.event_id)) };
      await this.writeSharedEventsCache(this.events).catch((err) => console.error("[events_cache] write failed:", err));
    }

    return { deletedItems, deletedEvents };
  }
}