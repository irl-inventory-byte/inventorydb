import { google, type sheets_v4 } from "googleapis";
import { TABS, type Row, type TabName } from "../schema";
import type {
  DeleteItemResult,
  TableBackend,
} from "./backend";

function columnLetter(n: number): string {
  let result = "";

  for (
    let index = n;
    index > 0;
    index = Math.floor((index - 1) / 26)
  ) {
    result =
      String.fromCharCode(
        65 + ((index - 1) % 26)
      ) + result;
  }

  return result;
}

const tabs = Object.keys(TABS) as TabName[];

/**
 * Google answers 429 ("too many requests") when the per-minute limit is used up, and sometimes a short
 * 500/503. Wait and try again (1 s, 2 s, 4 s) instead of failing the page. Writes are only retried on 429,
 * because then Google did not save anything, so a retry can never add a row twice.
 */
async function withRetry<T>(fn: () => Promise<T>, write = false): Promise<T> {
  const waits = [1000, 2000, 4000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: number | string; status?: number; response?: { status?: number } };
      const status = Number(e.response?.status ?? e.status ?? e.code);
      const retryable = status === 429 || (!write && (status === 500 || status === 502 || status === 503));
      if (!retryable || attempt >= waits.length) throw err;
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

export interface SheetsConfig {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
}

export class SheetsBackend implements TableBackend {
  private api: sheets_v4.Sheets;

  constructor(private cfg: SheetsConfig) {
    const auth = new google.auth.JWT({
      email: cfg.clientEmail,
      key: cfg.privateKey.replace(/\\n/g, "\n"),
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
      ],
    });

    this.api = google.sheets({
      version: "v4",
      auth,
    });
  }

  private get id() {
    return this.cfg.spreadsheetId;
  }

  async ensureTabs() {
    const meta = await this.api.spreadsheets.get({
      spreadsheetId: this.id,
      fields: "sheets.properties.title",
    });

    const existing = new Set(
      meta.data.sheets?.map(
        (sheet) => sheet.properties?.title
      )
    );

    const missing = tabs.filter(
      (tab) => !existing.has(tab)
    );

    if (missing.length) {
      await this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.id,
        requestBody: {
          requests: missing.map((title) => ({
            addSheet: {
              properties: { title },
            },
          })),
        },
      });
    }

    await this.api.spreadsheets.values.batchUpdate({
      spreadsheetId: this.id,
      requestBody: {
        valueInputOption: "RAW",
        data: tabs.map((tab) => ({
          range: `${tab}!A1:${columnLetter(
            TABS[tab].length
          )}1`,
          values: [[...TABS[tab]]],
        })),
      },
    });
  }

  async readAll(tab: TabName): Promise<Row[]> {
    const columns = TABS[tab];

    const result: { data: sheets_v4.Schema$ValueRange } = await withRetry(() =>
      this.api.spreadsheets.values.get({
        spreadsheetId: this.id,
        range: `${tab}!A2:${columnLetter(columns.length)}`,
      }),
    );

    return (result.data.values ?? [])
      .filter(
        (row) =>
          row[0] !== undefined &&
          row[0] !== ""
      )
      .map((row) =>
        Object.fromEntries(
          columns.map((column, index) => [
            column,
            String(row[index] ?? ""),
          ])
        )
      );
  }

  private toValues(tab: TabName, rows: Row[]) {
    return rows.map((row) =>
      TABS[tab].map(
        (column) => row[column] ?? ""
      )
    );
  }

  async append(tab: TabName, rows: Row[]) {
    if (!rows.length) return;

    await withRetry(
      () =>
        this.api.spreadsheets.values.append({
          spreadsheetId: this.id,
          range: `${tab}!A1`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: {
            values: this.toValues(tab, rows),
          },
        }),
      true,
    );
  }

  async upsert(tab: TabName, rows: Row[]) {
    if (!rows.length) return;

    const columns = TABS[tab];
    const key = columns[0];
    const last = columnLetter(columns.length);

    const keys: { data: sheets_v4.Schema$ValueRange } = await withRetry(() =>
      this.api.spreadsheets.values.get({
        spreadsheetId: this.id,
        range: `${tab}!A:A`,
      }),
    );

    const rowOf = new Map<string, number>();

    (keys.data.values ?? []).forEach(
      (row, index) => {
        if (index > 0 && row[0]) {
          rowOf.set(
            String(row[0]),
            index + 1
          );
        }
      }
    );

    const updates: sheets_v4.Schema$ValueRange[] = [];
    const inserts: Row[] = [];

    for (const row of rows) {
      const at = rowOf.get(row[key]);

      if (at) {
        updates.push({
          range: `${tab}!A${at}:${last}${at}`,
          values: this.toValues(tab, [row]),
        });
      } else {
        inserts.push(row);
      }
    }

    if (updates.length) {
      await withRetry(
        () =>
          this.api.spreadsheets.values.batchUpdate({
            spreadsheetId: this.id,
            requestBody: {
              valueInputOption: "RAW",
              data: updates,
            },
          }),
        true,
      );
    }

    await this.append(tab, inserts);
  }

  /**
   * Delete one exact item ID and its matching event history.
   *
   * Both sets of values are cleared in one atomic Sheets
   * batchUpdate request. However, the preceding read is separate:
   * pause other writers/manual edits during deletion.
   *
   * This affects the inventory database only, not ASSET_SHEET_ID.
   */
  async deleteItemAndHistory(
    itemId: string
  ): Promise<DeleteItemResult> {
    if (!itemId.trim()) {
      throw new Error("An item ID is required.");
    }

    const [meta, itemResult, eventResult] =
      await Promise.all([
        this.api.spreadsheets.get({
          spreadsheetId: this.id,
          fields: "sheets.properties(sheetId,title)",
        }),

        this.api.spreadsheets.values.get({
          spreadsheetId: this.id,
          range: "items!A2:A",
          valueRenderOption: "UNFORMATTED_VALUE",
        }),

        this.api.spreadsheets.values.get({
          spreadsheetId: this.id,
          range: `events!A2:${columnLetter(
            TABS.events.length
          )}`,
          valueRenderOption: "UNFORMATTED_VALUE",
        }),
      ]);

    const sheetIds = new Map<string, number>();

    for (const sheet of meta.data.sheets ?? []) {
      const title = sheet.properties?.title;
      const sheetId = sheet.properties?.sheetId;

      if (
        title &&
        sheetId !== undefined &&
        sheetId !== null
      ) {
        sheetIds.set(title, sheetId);
      }
    }

    const itemsSheetId = sheetIds.get("items");
    const eventsSheetId = sheetIds.get("events");

    if (
      itemsSheetId === undefined ||
      eventsSheetId === undefined
    ) {
      throw new Error(
        "The items or events sheet is missing."
      );
    }

    /*
     * Range starts at row 2, which is zero-based row index 1.
     * Preserve blank row positions when finding matches.
     */
    const itemRowIndexes: number[] = [];

    (itemResult.data.values ?? []).forEach(
      (row, index) => {
        if (String(row[0] ?? "") === itemId) {
          itemRowIndexes.push(index + 1);
        }
      }
    );

    if (itemRowIndexes.length === 0) {
      throw new Error(
        "Item not found. Nothing was deleted."
      );
    }

    if (itemRowIndexes.length > 1) {
      throw new Error(
        "Duplicate item IDs found. Resolve duplicates before deleting."
      );
    }

    const eventItemColumn =
      TABS.events.indexOf("item_id");

    const eventRowIndexes: number[] = [];

    (eventResult.data.values ?? []).forEach(
      (row, index) => {
        if (
          String(row[eventItemColumn] ?? "") ===
          itemId
        ) {
          eventRowIndexes.push(index + 1);
        }
      }
    );

    const requests: sheets_v4.Schema$Request[] = [];

    function addClearRequests(
      sheetId: number,
      rowIndexes: number[],
      columnCount: number
    ) {
      // Combine adjacent matches into a single range.
      for (
        let index = 0;
        index < rowIndexes.length;
        index++
      ) {
        const start = rowIndexes[index];
        let end = start + 1;

        while (
          index + 1 < rowIndexes.length &&
          rowIndexes[index + 1] === end
        ) {
          index++;
          end++;
        }

        requests.push({
          updateCells: {
            range: {
              sheetId,
              startRowIndex: start,
              endRowIndex: end,
              startColumnIndex: 0,
              endColumnIndex: columnCount,
            },

            // Clear values in this range, preserving formatting.
            rows: [],
            fields: "userEnteredValue",
          },
        });
      }
    }

    addClearRequests(
      eventsSheetId,
      eventRowIndexes,
      TABS.events.length
    );

    addClearRequests(
      itemsSheetId,
      itemRowIndexes,
      TABS.items.length
    );

    await this.api.spreadsheets.batchUpdate({
      spreadsheetId: this.id,
      requestBody: { requests },
    });

    return {
      deletedItems: itemRowIndexes.length,
      deletedEvents: eventRowIndexes.length,
    };
  }
}