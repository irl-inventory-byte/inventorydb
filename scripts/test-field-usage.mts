import assert from "node:assert/strict";
import { fieldUsage, usageFilterOptions } from "../src/lib/field-usage";
import { hourlyMoves } from "../src/lib/daily-moves";
import type { Hub, Item, ItemEvent, Person } from "../src/lib/schema";

const hub = (id: string, city = id): Hub => ({ hub_id: id, name: id, city, is_central: "false", active: "true", parent_hub: "" });
const hubs = [hub("blr", "Bangalore"), hub("kdp", "Kadapa")];
const person = (id: string, role: Person["role"]): Person => ({ person_id: id, name: id.toUpperCase(), role, hub: "kdp", linked_user: "", active: "true" });
const people = [person("fo1", "fo"), person("fo2", "fo"), person("im1", "im")];
const item = (id: string, over: Partial<Item> = {}): Item => ({
  item_id: id, item_type: "rig", home_hub: "blr", current_hub: "blr", status: "in_stock", current_holder: "", last_event_id: "",
  updated_at: "", attributes: "", prism_no: "", brand: "Insta", model: "X3", price: "", ...over,
});
let seq = 0;
const ev = (item_id: string, action: ItemEvent["action"], at: string, over: Partial<ItemEvent> = {}): ItemEvent => ({
  event_id: `E${++seq}`, batch_id: "b", item_id, action, from_person: "", to_person: "", from_id: "im1", to_id: "", from_hub: "kdp", hub: "kdp",
  status_after: action === "check_out" ? "with_fo" : "in_stock", occurred_at: at, recorded_at: at, recorded_by: "x", note: "", ...over,
});
const now = new Date("2026-10-20T12:00:00+05:30");
const range = { from: "2026-10-01", to: "2026-10-20" };

const items = [item("A"), item("B"), item("C"), item("D", { status: "retired" }), item("E", { home_hub: "kdp", current_hub: "kdp" })];
const events = [
  // A: two FO uses, 2 days + 1 day
  ev("A", "check_out", "2026-10-02T10:00:00+05:30", { to_id: "fo1" }),
  ev("A", "receive", "2026-10-04T10:00:00+05:30"),
  ev("A", "check_out", "2026-10-10T09:00:00+05:30", { to_id: "fo2" }),
  ev("A", "receive", "2026-10-11T09:00:00+05:30"),
  // B: one FO use, still out (since 18 Oct 12:00 → 2 days)
  ev("B", "check_out", "2026-10-18T12:00:00+05:30", { to_id: "fo1" }),
  // C: sent to an IFO (traveling) only, and an FO use before the range
  ev("C", "check_out", "2026-10-05T10:00:00+05:30", { to_id: "x", status_after: "traveling" }),
  ev("C", "check_out", "2026-09-01T10:00:00+05:30", { to_id: "fo2" }),
  ev("C", "receive", "2026-09-03T10:00:00+05:30"),
  // D: retired, used once
  ev("D", "check_out", "2026-10-03T10:00:00+05:30", { to_id: "fo1" }),
  // E: in Kadapa, never used
];

const u = fieldUsage(items, events, hubs, people, range, {}, now);
assert.deepEqual(u.used.map((r) => [r.item.item_id, r.uses, r.fieldDays, r.fos]), [["A", 2, 3, 2], ["B", 1, 2, 1]]);
assert.deepEqual(u.never.map((r) => r.item.item_id), ["E", "C"], "never on field first, then oldest last use");
assert.equal(u.never[1].lastUsed, "2026-09-01T10:00:00+05:30");
assert.equal(u.never[1].lastFo, "FO2");
assert.equal(u.items, 4, "retired D hidden by default");
assert.equal(u.totalUses, 3);

const withOut = fieldUsage(items, events, hubs, people, range, { includeOut: true }, now);
assert.ok(withOut.used.some((r) => r.item.item_id === "D"));

const fo1 = fieldUsage(items, events, hubs, people, range, { person: "fo1" }, now);
assert.deepEqual(fo1.used.map((r) => [r.item.item_id, r.uses]), [["A", 1], ["B", 1]]);

const blr = fieldUsage(items, events, hubs, people, range, { city: "Bangalore" }, now);
assert.deepEqual(blr.used.map((r) => r.item.item_id), [], "all FO check-outs were in Kadapa");
assert.deepEqual(blr.never.map((r) => r.item.item_id).sort(), ["A", "B", "C"], "never-used uses home/current hub city");

const opts = usageFilterOptions(items, events, hubs, people);
assert.deepEqual(opts.fos.map((f) => f.id), ["fo1", "fo2"]);
assert.deepEqual(opts.cities, ["Bangalore", "Kadapa"]);
assert.deepEqual(opts.models, ["Insta X3"]);

// Hourly: India time hours, check-outs and receives only, inside the range
const h = hourlyMoves(events, hubs, range, {}, people);
assert.equal(h.length, 24);
assert.equal(h[10].sent, 3, "A, C(traveling), D at 10:00");
assert.equal(h[10].received, 1);
assert.equal(h[9].sent, 1);
assert.equal(h[9].received, 1);
assert.equal(h[12].sent, 1);
assert.equal(h.reduce((s, x) => s + x.sent + x.received, 0), 7, "September events are outside the range");
const hf = hourlyMoves(events, hubs, range, { person: "fo2" }, people);
assert.equal(hf.reduce((s, x) => s + x.sent, 0), 1);

console.log("field usage + hourly: all checks passed");
