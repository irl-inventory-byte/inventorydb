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
   * Permanently remove one item and its associated events.
   * Optional because not every backend implements deletion.
   */
  deleteItemAndHistory?(
    itemId: string
  ): Promise<DeleteItemResult>;
}