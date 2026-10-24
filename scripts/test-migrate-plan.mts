import assert from "node:assert/strict";
import { TABS } from "../src/lib/schema";
import { dedupe, rowsFromSheet } from "../src/lib/migrate-plan";

const ev = TABS.events;

// Columns are read by heading: a sheet with columns in another order, an extra column and a missing one.
const read = rowsFromSheet(
  [
    ["item_id", "event_id", "Extra notes", "action", "occurred_at"],
    ["SD-1", "e-1", "keep me", "send", "2026-01-01"],
    ["", "", "", "", ""], // blank row
    ["SD-2", "  ", "x", "send", ""], // blank key
    ["SD-3", "e-2", "", "receive"], // short row
  ],
  ev,
);
assert.equal(read.rows.length, 2);
assert.equal(read.rows[0].event_id, "e-1");
assert.equal(read.rows[0].item_id, "SD-1");
assert.equal(read.rows[0].action, "send");
assert.equal(read.rows[0].hub, ""); // no heading → blank
assert.equal(read.rows[1].occurred_at, ""); // short row → blank
assert.deepEqual(read.unknownColumns, ["Extra notes"]);
assert.ok(read.missingColumns.includes("from_hub"));
assert.ok(!read.missingColumns.includes("event_id"));
assert.deepEqual(Object.keys(read.rows[0]), [...ev]); // every app column, app order

// Headings are matched ignoring case and spaces around them.
assert.equal(rowsFromSheet([[" Event_ID ", "ITEM_ID"], ["e-9", "SD-9"]], ev).rows[0].item_id, "SD-9");

// A tab with no heading row at all falls back to the app's column order.
const noHead = rowsFromSheet([["", ""]], ["type", "fields"]);
assert.equal(noHead.rows.length, 0);

// History: nothing is lost.
const e = (event_id: string, item_id: string, action = "send") => {
  const r: Record<string, string> = Object.fromEntries(ev.map((c) => [c, ""]));
  return { ...r, event_id, item_id, action };
};
const history = [
  e("e-a", "SD-1"),
  e("e-a", "SD-2", "receive"), // same ID, different event
  e("e-b", "SD-3"),
  e("e-b", "SD-3"), // exact copy-paste
  e("e-c", "SD-4"),
  e("e-a", "SD-5"), // third use of e-a
  e("e-a~2", "SD-6"), // an ID that already looks like a renamed one
];
const plan = dedupe("events", history, "event_id");
assert.equal(plan.rows.length, 6); // only the exact copy is gone
assert.equal(plan.exactCopies, 1);
assert.equal(new Set(plan.rows.map((r) => r.event_id)).size, 6); // all IDs unique now
assert.deepEqual(plan.rows.map((r) => r.item_id), ["SD-1", "SD-2", "SD-3", "SD-4", "SD-5", "SD-6"]); // sheet order
// The last one keeps the ID (what the app shows today); the others are renamed without clashing.
assert.equal(plan.rows.find((r) => r.item_id === "SD-5")!.event_id, "e-a");
assert.equal(plan.rows.find((r) => r.item_id === "SD-6")!.event_id, "e-a~2");
assert.deepEqual(
  plan.renamed.map((x) => x.to),
  ["e-a~3", "e-a~4"],
);

// The row an item points to as its last event keeps the original ID.
const kept = dedupe("events", history, "event_id", (r) => r.item_id === "SD-1" && r.event_id === "e-a");
assert.equal(kept.rows.find((r) => r.item_id === "SD-1")!.event_id, "e-a");
assert.notEqual(kept.rows.find((r) => r.item_id === "SD-5")!.event_id, "e-a");

// No duplicates: rows come back unchanged.
const clean = [e("e-1", "SD-1"), e("e-2", "SD-1")];
assert.deepEqual(dedupe("events", clean, "event_id").rows, clean);

// Lookup tabs: the last row with an ID wins, like the app.
const people = dedupe(
  "people",
  [
    { person_id: "p1", name: "Old" },
    { person_id: "p2", name: "B" },
    { person_id: "p1", name: "New" },
  ],
  "person_id",
);
assert.deepEqual(people.rows.map((r) => r.name), ["B", "New"]);
assert.deepEqual(people.replaced, ["p1"]);

console.log("migrate plan ok");
