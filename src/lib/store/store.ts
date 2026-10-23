import {
  findInconsistencies,
  type Inconsistency,
} from "../consistency";
import type {
  Item,
  ItemEvent,
  Row,
  TabName,
  TabRows,
} from "../schema";
import type {
  DeleteItemResult,
  TableBackend,
} from "./backend";
import { matchScan, mobileAliases, scanIndex } from "../scan";

// An item's type. Older rows without a type are SD cards.
const typeOf = (item: Row) => (item.item_type === "rig" ? "rig" : item.item_type === "mobile" ? "mobile" : "sd_card");

export class Store {
  /**
   * @param types When set, only items of these types (and their events,
   *   hardware updates and QC checks) are returned. Writes are not filtered.
   */
  constructor(
    private backend: TableBackend,
    private types?: ReadonlySet<string>
  ) {}

  /**
   * The same store, limited to some item types. Used so each login only
   * sees the items it is allowed to (see lib/access.ts).
   */
  forTypes(types: readonly string[]): Store {
    const all = types.includes("sd_card") && types.includes("rig") && types.includes("mobile");
    return all && !this.types ? this : new Store(this.backend, new Set(types));
  }

  init() {
    return this.backend.ensureTabs();
  }

  /** Read a tab that may not exist yet (new tabs are created on first write). */
  private async readOptional(tab: TabName): Promise<Row[]> {
    try {
      return await this.backend.readAll(tab);
    } catch {
      return [];
    }
  }

  async list<T extends TabName>(
    tab: T
  ): Promise<TabRows[T][]> {
    const optional = tab === "hardware_updates" || tab === "qc_checks" || tab === "rig_reports";
    const rows = optional
      ? await this.readOptional(tab)
      : await this.backend.readAll(tab);

    const types = this.types;
    if (!types) return rows as unknown as TabRows[T][];

    if (tab === "items") {
      return rows.filter((row) => types.has(typeOf(row))) as unknown as TabRows[T][];
    }

    if (tab === "events" || optional) {
      // Keep rows that belong to a visible item.
      const visible = new Set(
        (await this.backend.readAll("items"))
          .filter((item) => types.has(typeOf(item)))
          .map((item) => item.item_id)
      );
      return rows.filter((row) => visible.has(row.item_id)) as unknown as TabRows[T][];
    }

    return rows as unknown as TabRows[T][];
  }

  /** Add rows to a tab, creating the tab first if it does not exist yet. */
  async appendRows<T extends TabName>(tab: T, rows: TabRows[T][]) {
    try {
      await this.backend.append(tab, rows as unknown as Row[]);
    } catch {
      await this.backend.ensureTabs();
      await this.backend.append(tab, rows as unknown as Row[]);
    }
  }

  upsert<T extends TabName>(
    tab: T,
    rows: Partial<TabRows[T]>[]
  ) {
    return this.backend.upsert(tab, rows as Row[]);
  }

  async getItem(itemId: string) {
    return (await this.list("items")).find(
      (item) => item.item_id === itemId
    );
  }

  /**
   * Look up scanned/typed IDs, ignoring letter case. A mobile is also found by an IMEI in a QR code
   * ("IMEI1 - IMEI2"), its Asset Tag or its Serial. Return a map keyed by the requested IDs.
   */
  async getItemsByIds(ids: string[]) {
    const items = await this.list("items");

    const exact = new Map(
      items.map((item) => [item.item_id, item])
    );
    // Mobiles can also be found by their IMEI (QR code), Asset Tag or Serial.
    const phoneAliases = new Map(
      items.filter((item) => item.item_type === "mobile").map((item) => [item.item_id, mobileAliases(item.attributes)]),
    );
    const { byUpper, phones } = scanIndex(exact.keys(), phoneAliases);

    const found = new Map<string, Item>();

    for (const id of ids) {
      const match = matchScan(id, (x) => exact.has(x), byUpper, phones);
      const item = match === undefined ? undefined : exact.get(match);

      if (item) {
        found.set(id, item);
      }
    }

    return found;
  }

  async getHistory(itemId: string) {
    const events = (await this.list("events")).filter(
      (event) => event.item_id === itemId
    );

    return events.sort(
      (a, b) =>
        Date.parse(a.occurred_at) -
        Date.parse(b.occurred_at)
    );
  }

  /**
   * Save events first, then the derived item records.
   */
  async commitBatch(
    events: ItemEvent[],
    items: Item[]
  ) {
    await this.backend.append("events", events);
    await this.backend.upsert("items", items);
  }

  async checkConsistency(): Promise<Inconsistency[]> {
    const [items, events] = await Promise.all([
      this.list("items"),
      this.list("events"),
    ]);

    return findInconsistencies(items, events);
  }

    /**
   * Record a permanent deletion in the "deletions" tab.
   * Creates the tab the first time it is needed.
   */
  async logDeletion(row: TabRows["deletions"]) {
    try {
      await this.backend.append("deletions", [row]);
    } catch {
      await this.backend.ensureTabs();
      await this.backend.append("deletions", [row]);
    }
  }
  
  /**
   * Record an admin edit to a past receipt in the "receipt_edits" tab.
   * Creates the tab the first time it is needed.
   */
  async logReceiptEdit(row: TabRows["receipt_edits"]) {
    try {
      await this.backend.append("receipt_edits", [row]);
    } catch {
      await this.backend.ensureTabs();
      await this.backend.append("receipt_edits", [row]);
    }
  }

  /**
   * Permanent deletion.
   * The calling server action must enforce Admin authorization.
   */
  async deleteItemAndHistory(
    itemId: string
  ): Promise<DeleteItemResult> {
    const id = itemId.trim();

    if (!id) {
      throw new Error("An item ID is required.");
    }

    if (!this.backend.deleteItemAndHistory) {
      throw new Error(
        "Permanent deletion is not supported by the active storage backend."
      );
    }

    return this.backend.deleteItemAndHistory(id);
  }
}