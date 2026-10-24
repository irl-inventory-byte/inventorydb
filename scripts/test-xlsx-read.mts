import assert from "node:assert/strict";
import { buildXlsx } from "../src/lib/xlsx";
import { readXlsx } from "../src/lib/xlsx-read";
import { rowsFromSheet } from "../src/lib/migrate-plan";
import { TABS } from "../src/lib/schema";

// Round trip through the app's own Excel writer.
const file = buildXlsx([
  {
    name: "events",
    header: ["event_id", "item_id", "action", "occurred_at", "note"],
    rows: [
      ["e-1", "SD-1", "send", "2026-09-25T19:14:54+05:30", 'A & B <say> "hi"'],
      ["e-2", "SD-2", "receive", { date: new Date("2026-09-25T13:44:54Z") }, ""], // a typed date
      [],
      ["e-3", "SD-3", "add", "", "line1\nline2 ₹ हिंदी"],
    ],
  },
  {
    name: "people",
    header: ["person_id", "name", "mobile", "active"],
    rows: [["p1", "Ravi", 9876543210, "true"], ["p2", "Asha", 0.1 + 0.2, ""]],
  },
]);

const book = readXlsx(file);
assert.deepEqual(book.map((s) => s.name), ["events", "people"]);

const events = book[0];
assert.deepEqual(events.values[0], ["event_id", "item_id", "action", "occurred_at", "note"]);
assert.equal(events.values[1][4], 'A & B <say> "hi"'); // escaped characters
assert.equal(events.values[2][3], "2026-09-25T19:14:54+05:30"); // typed date → India-time timestamp
assert.equal(events.datesConverted, 1);
assert.equal(events.values[4][4], "line1\nline2 ₹ हिंदी"); // new lines and non-English text
assert.equal(events.values[4][3], ""); // empty cell inside a row

const people = book[1];
assert.equal(people.values[1][2], "9876543210"); // never 9.87E+09
assert.equal(people.values[2][2], "0.3"); // no float noise

// Straight into the migration: blank row skipped, columns by heading.
const rows = rowsFromSheet(events.values, TABS.events).rows;
assert.deepEqual(rows.map((r) => r.event_id), ["e-1", "e-2", "e-3"]);
assert.equal(rows[1].occurred_at, "2026-09-25T19:14:54+05:30");

assert.throws(() => readXlsx(Buffer.from("not a zip at all")), /not an \.xlsx/);

console.log("xlsx read ok");
