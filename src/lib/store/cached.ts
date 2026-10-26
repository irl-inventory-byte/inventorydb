import { TABS, type Row, type TabName } from "../schema";
import type { DeleteItemResult, TableBackend } from "./backend";

/**
 * Wraps a backend (Google Sheets) so the same tab is not downloaded again and again.
 *
 * One page or one send used to read the same tab many times (the items tab up to 5 times), and every
 * read counts against Google's per-minute limit. Now:
 *   - reads that happen at the same time share ONE download;
 *   - a tab read in the last few seconds is reused (TTL_MS);
 *   - any write to a tab clears that tab's copy, so the next read is fresh.
 * Each caller gets its own copy of the rows, so nobody can change another caller's data.
 */
const TTL_MS = 15_000; // a tab read in the last 15 s is reused; this server's own writes update it at once

export class CachedBackend implements TableBackend {
  private cache = new Map<TabName, { at: number; rows: Row[] }>();
  private inFlight = new Map<TabName, Promise<Row[]>>();

  constructor(private inner: TableBackend) {
    if (inner.deleteItemAndHistory) {
      this.deleteItemAndHistory = async (itemId: string): Promise<DeleteItemResult> => {
        try {
          return await inner.deleteItemAndHistory!(itemId);
        } finally {
          this.clear("items", "events");
        }
      };
    }
  }

  deleteItemAndHistory?: (itemId: string) => Promise<DeleteItemResult>;

  private clear(...tabs: TabName[]) {
    for (const t of tabs) {
      this.cache.delete(t);
      this.inFlight.delete(t);
    }
  }

  private copy(rows: Row[]): Row[] {
    return rows.map((r) => ({ ...r }));
  }

  async ensureTabs() {
    try {
      await this.inner.ensureTabs();
    } finally {
      this.cache.clear();
      this.inFlight.clear();
    }
  }

  async readAll(tab: TabName): Promise<Row[]> {
    const hit = this.cache.get(tab);
    if (hit && Date.now() - hit.at < TTL_MS) return this.copy(hit.rows);

    let pending = this.inFlight.get(tab);
    if (!pending) {
      pending = this.inner.readAll(tab).then(
        (rows) => {
          // Only keep it if no write cleared this read while it was running.
          if (this.inFlight.get(tab) === pending) {
            this.cache.set(tab, { at: Date.now(), rows });
            this.inFlight.delete(tab);
          }
          return rows;
        },
        (err) => {
          if (this.inFlight.get(tab) === pending) this.inFlight.delete(tab);
          throw err;
        },
      );
      this.inFlight.set(tab, pending);
    }
    return this.copy(await pending);
  }

  // Writes go to the backend first. On success the cached copy is updated in place (write-through), so the
  // page shown right after a send, receive or correction does not download the whole tab again. If the
  // write fails, the copy is dropped and the next read is fresh.
  async append(tab: TabName, rows: Row[]) {
    try {
      await this.inner.append(tab, rows);
    } catch (err) {
      this.clear(tab);
      throw err;
    }
    const hit = this.cache.get(tab);
    if (hit && !this.inFlight.has(tab)) hit.rows.push(...this.copy(rows));
    else this.clear(tab);
  }

  async upsert(tab: TabName, rows: Row[]) {
    try {
      await this.inner.upsert(tab, rows);
    } catch (err) {
      this.clear(tab);
      throw err;
    }
    const hit = this.cache.get(tab);
    if (!hit || this.inFlight.has(tab)) {
      this.clear(tab);
      return;
    }
    // Same rule as the backend: a row with a known key (first column) replaces it, others are added.
    const key = TABS[tab][0];
    const at = new Map(hit.rows.map((r, i) => [r[key], i]));
    for (const r of rows) {
      const i = at.get(r[key]);
      if (i === undefined) {
        at.set(r[key], hit.rows.length);
        hit.rows.push({ ...r });
      } else {
        hit.rows[i] = { ...hit.rows[i], ...r };
      }
    }
  }
}