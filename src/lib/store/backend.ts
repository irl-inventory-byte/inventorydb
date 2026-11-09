import type { Row, TabName } from "../schema";

export interface DeleteItemResult {
  deletedItems: number;
  deletedEvents: number;
}

// Operations implemented by each storage backend.
export interface TableBackend {
  /** Create missing tabs and write/extend header rows. */
  ensureTabs(): Promise<void>;

  /** Read all records in a tab. */
  readAll(tab: TabName): Promise<Row[]>;

  /** Append records to the end of a tab. */
  append(tab: TabName, rows: Row[]): Promise<void>;

  /** Update existing records and append new records. */
  upsert(tab: TabName, rows: Row[]): Promise<void>;

  /**
   * Fetch only the given events, by event_id, instead of the whole table. Lets pages that only need
   * a handful of specific events (e.g. the one each item last changed by, via item.last_event_id) avoid
   * downloading the full events history. Optional: a backend that doesn't implement this falls back to
   * filtering readAll("events").
   */
  getEventsByIds?(ids: string[]): Promise<Row[]>;

  /**
   * Delete one row from a tab by its key column (the tab's first column — e.g. note_id for delay_notes).
   * Optional: only implemented for backends/tabs that need row-level deletion from the app itself (as
   * opposed to editing the table directly in Supabase).
   */
  deleteRow?(tab: TabName, id: string): Promise<void>;

  /**
   * Permanently remove one item and its associated events.
   * Optional because not every backend implements deletion.
   */
  deleteItemAndHistory?(
    itemId: string
  ): Promise<DeleteItemResult>;
}