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
    tab: TabName,
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

  async readAll(tab: TabName): Promise<Row[]> {
    const columns = TABS[tab];
    const rows: Row[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await this.call("GET", tab, `select=${columns.join(",")}&order=_seq.asc&limit=${PAGE}&offset=${offset}`);
      const page = (await res.json()) as Record<string, unknown>[];
      for (const r of page) {
        const row: Row = {};
        for (const c of columns) row[c] = r[c] === null || r[c] === undefined ? "" : String(r[c]);
        rows.push(row);
      }
      if (page.length < PAGE) break;
    }
    return rows;
  }

  async append(tab: TabName, rows: Row[]) {
    const clean = this.clean(tab, rows);
    for (let i = 0; i < clean.length; i += CHUNK) {
      await this.call("POST", tab, "", clean.slice(i, i + CHUNK), { Prefer: "return=minimal" });
    }
  }

  /** Update rows whose key exists, add the rest. Existing rows keep their place in the order. */
  async upsert(tab: TabName, rows: Row[]) {
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