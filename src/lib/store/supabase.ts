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
const PARALLEL = 8; // page requests at the same time when reading a big table
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
      ...extra,
    };
    // Old-style keys are JWTs and also go in Authorization. New sb_secret_ keys work from apikey alone.
    if (this.cfg.key.startsWith("eyJ")) h.Authorization = `Bearer ${this.cfg.key}`;
    return h;
  }

  private async call(
    method: "GET" | "POST" | "DELETE",
    tab: TabName | "table_versions",
    query: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Response> {
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

  private kept = new Map<TabName, { v: string; rows: Row[] }>();
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

  /** Forget kept copies (and the counters) so the next read cannot miss a write. */
  private forget(...tabs: TabName[]) {
    for (const t of tabs) this.kept.delete(t);
    this.versions = null;
  }

  /** Run a write; forget before AND after, so the page shown right after saving is fresh. */
  private async writing<T>(tabs: TabName[], fn: () => Promise<T>): Promise<T> {
    this.forget(...tabs);
    try {
      return await fn();
    } finally {
      this.forget(...tabs);
    }
  }

  /** All rows, oldest first; reuses the kept copy when the table has not changed since. */
  async readAll(tab: TabName): Promise<Row[]> {
    // Counter BEFORE rows: a write that lands in between makes the next read fetch again.
    const map = await this.readVersions();
    if (!map) return this.download(tab);

    const v = map.get(tab) ?? "0"; // "0" = never written since the counters were added
    const hit = this.kept.get(tab);
    if (hit && hit.v === v) return hit.rows.map((r) => ({ ...r }));

    const rows = await this.download(tab);
    this.kept.set(tab, { v, rows });
    return rows.map((r) => ({ ...r }));
  }

  /**
   * All rows, oldest first. Supabase gives at most PAGE rows per request, so a big table (events) needs
   * many requests. The first one also asks for the total, then the rest are fetched AT THE SAME TIME
   * (PARALLEL at once) instead of one after another, so 50 pages take about as long as 7, not 50.
   */
  private async download(tab: TabName): Promise<Row[]> {
    const columns = TABS[tab];
    const select = `select=${columns.join(",")}&order=_seq.asc`;
    const toRows = (page: Record<string, unknown>[]): Row[] =>
      page.map((r) => {
        const row: Row = {};
        for (const c of columns) row[c] = r[c] === null || r[c] === undefined ? "" : String(r[c]);
        return row;
      });
    const fetchPage = async (offset: number, count = false) => {
      const res = await this.call(
        "GET",
        tab,
        `${select}&limit=${PAGE}&offset=${offset}`,
        undefined,
        count ? { Prefer: "count=exact" } : {},
      );
      return { res, page: (await res.json()) as Record<string, unknown>[] };
    };

    // First page, with the total ("Content-Range: 0-999/53412").
    const first = await fetchPage(0, true);
    const total = Number(first.res.headers.get("content-range")?.split("/")[1]);
    const pages: Record<string, unknown>[][] = [first.page];

    if (Number.isFinite(total) && total > PAGE) {
      const offsets: number[] = [];
      for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
      const rest: Record<string, unknown>[][] = new Array(offsets.length);
      let next = 0;
      const worker = async () => {
        while (next < offsets.length) {
          const i = next++;
          rest[i] = (await fetchPage(offsets[i])).page;
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, offsets.length) }, worker));
      pages.push(...rest);
      // Rows added while reading: pick them up the old way.
      for (let o = PAGE * (offsets.length + 1); pages[pages.length - 1].length === PAGE; o += PAGE) {
        pages.push((await fetchPage(o)).page);
      }
    } else if (!Number.isFinite(total)) {
      // No total in the answer: fall back to one page after another.
      for (let o = PAGE; pages[pages.length - 1].length === PAGE; o += PAGE) pages.push((await fetchPage(o)).page);
    }

    return pages.flatMap(toRows);
  }

  async append(tab: TabName, rows: Row[]) {
    await this.writing([tab], async () => {
      const clean = this.clean(tab, rows);
      for (let i = 0; i < clean.length; i += CHUNK) {
        await this.call("POST", tab, "", clean.slice(i, i + CHUNK), { Prefer: "return=minimal" });
      }
    });
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

  /** Permanent deletion of one item and its history. The calling server action checks it is an admin. */
  async deleteItemAndHistory(itemId: string): Promise<DeleteItemResult> {
    if (!itemId.trim()) throw new Error("An item ID is required.");
    return this.writing(["items", "events"], () => this.deleteNow(itemId));
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
    const deletedEvents = ((await ev.json()) as unknown[]).length;
    const it = await this.call("DELETE", "items", `item_id=eq.${id}&select=item_id`, undefined, {
      Prefer: "return=representation",
    });
    const deletedItems = ((await it.json()) as unknown[]).length;
    return { deletedItems, deletedEvents };
  }
}