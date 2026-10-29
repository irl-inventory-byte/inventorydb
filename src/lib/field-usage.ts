import type { Hub, Item, ItemEvent, Person } from "./schema";
import { hubCityMap, manyValues, type DayRange, type Many } from "./daily-moves";
import { istDate } from "./time";

/**
 * Field usage: how often each asset (rig, SD card, mobile) was used on the field.
 * "Used" = checked out on an FO's name (a check-out whose status after is "With FO").
 *
 * For the chosen India-day range, every item gets:
 *   uses      FO check-outs in the range
 *   fieldDays days those check-outs lasted: until the item's next movement, or now if still out
 *   lastUsed  its latest FO check-out ever (for "when was it last on the field")
 * and the items are split into most used, least used (used at least once) and never used (in the range).
 */

const DAY = 86_400_000;

// Out of service: hidden from the lists unless "Include out-of-service items" is ticked.
export const OUT_OF_SERVICE = new Set(["lost", "damaged", "retired", "rnd"]);

export interface UsageFilter {
  city?: Many; // FO check-outs at a hub in one of these cities; never-used items: home or current hub there
  person?: Many; // person_id(s) of FOs: only check-outs to these FOs
  model?: Many; // "Brand Model" as shown in the Model filter (one or several)
  includeOut?: boolean; // include lost / damaged / retired / R&D items
}

export interface UsageRow {
  item: Item;
  uses: number;
  fieldDays: number; // one decimal
  lastUsed: string; // ISO timestamp of the latest FO check-out ever, "" if never
  lastFo: string; // name of that FO
  fos: number; // different FOs in the range
}

export interface FieldUsage {
  used: UsageRow[]; // most used first
  never: UsageRow[]; // never used in the range; longest since last use first
  totalUses: number;
  items: number; // items in scope
}

/** "Brand Model", without repeating the brand when the model already starts with it ("SanDisk Extreme"). */
export const modelLabel = (i: Pick<Item, "brand" | "model">) => {
  const brand = (i.brand ?? "").trim();
  const model = (i.model ?? "").trim();
  if (brand && model.toLowerCase().startsWith(brand.toLowerCase())) return model;
  return [brand, model].filter(Boolean).join(" ");
};

const isFoCheckout = (e: ItemEvent) => e.action === "check_out" && e.status_after === "with_fo";

export function fieldUsage(
  items: Item[],
  events: ItemEvent[],
  hubs: Hub[],
  people: Person[],
  range: DayRange,
  f: UsageFilter = {},
  now: Date = new Date(),
): FieldUsage {
  const city = hubCityMap(hubs);
  const name = new Map(people.map((p) => [p.person_id, p.name]));
  const cityOf = (hub: string) => city.get(hub) ?? hub;
  const byItem = new Map<string, ItemEvent[]>();
  for (const e of events) {
    const list = byItem.get(e.item_id);
    if (list) list.push(e);
    else byItem.set(e.item_id, [e]);
  }
  const time = (e: ItemEvent) => {
    const t = Date.parse(e.occurred_at);
    return Number.isNaN(t) ? 0 : t;
  };

  const cities = new Set(manyValues(f.city));
  const persons = new Set(manyValues(f.person));
  const models = new Set(manyValues(f.model));
  const used: UsageRow[] = [];
  const never: UsageRow[] = [];
  let totalUses = 0;
  let inScope = 0;
  for (const item of items) {
    if (!f.includeOut && OUT_OF_SERVICE.has(item.status)) continue;
    if (models.size && !models.has(modelLabel(item))) continue;
    const history = (byItem.get(item.item_id) ?? []).slice().sort((a, b) => time(a) - time(b));

    let uses = 0;
    let ms = 0;
    let lastUsed = "";
    let lastFo = "";
    const fos = new Set<string>();
    history.forEach((e, idx) => {
      if (!isFoCheckout(e)) return;
      lastUsed = e.occurred_at;
      lastFo = name.get(e.to_id) || e.to_person || e.to_id;
      const day = istDate(new Date(time(e)));
      if (day < range.from || day > range.to) return;
      if (persons.size && !persons.has(e.to_id)) return;
      if (cities.size && !cities.has(cityOf(e.hub)) && !cities.has(cityOf(e.from_hub))) return;
      uses++;
      fos.add(e.to_id || e.to_person);
      const next = history.slice(idx + 1).find((n) => time(n) >= time(e) && n.action !== "correct");
      ms += Math.max(0, (next ? time(next) : now.getTime()) - time(e));
    });

    if (uses === 0) {
      // Never used: the FO filter cannot apply; the city filter uses the item's home or current hub.
      if (cities.size && !cities.has(cityOf(item.home_hub)) && !cities.has(cityOf(item.current_hub))) continue;
    }
    inScope++;
    const row = { item, uses, fieldDays: Math.round((ms / DAY) * 10) / 10, lastUsed, lastFo, fos: fos.size };
    if (uses > 0) {
      totalUses += uses;
      used.push(row);
    } else never.push(row);
  }

  used.sort((a, b) => b.uses - a.uses || b.fieldDays - a.fieldDays || a.item.item_id.localeCompare(b.item.item_id));
  // Never used: never on the field at all first, then the longest since the last use.
  never.sort((a, b) => (a.lastUsed || "").localeCompare(b.lastUsed || "") || a.item.item_id.localeCompare(b.item.item_id));
  return { used, never, totalUses, items: inScope };
}

/** Choices for the usage filters: cities, FOs and models that appear in these items and FO check-outs. */
export function usageFilterOptions(items: Item[], events: ItemEvent[], hubs: Hub[], people: Person[]) {
  const city = hubCityMap(hubs);
  const name = new Map(people.map((p) => [p.person_id, p.name]));
  const ids = new Set(items.map((i) => i.item_id));
  const cities = new Set<string>();
  const fos = new Map<string, string>();
  for (const i of items) for (const h of [i.home_hub, i.current_hub]) if (h) cities.add(city.get(h) ?? h);
  for (const e of events) {
    if (!ids.has(e.item_id) || !isFoCheckout(e)) continue;
    if (e.hub) cities.add(city.get(e.hub) ?? e.hub);
    if (e.to_id && !fos.has(e.to_id)) fos.set(e.to_id, name.get(e.to_id) || e.to_person || e.to_id);
  }
  const models = new Set(items.map(modelLabel).filter(Boolean));
  return {
    cities: [...cities].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    fos: [...fos.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    models: [...models].sort((a, b) => a.localeCompare(b)),
  };
}
