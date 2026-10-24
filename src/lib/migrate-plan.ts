import type { Row } from "./schema";

/**
 * Pure logic for the one-time Google Sheet → Supabase copy (scripts/migrate-to-supabase.mts).
 * No network here, so it can be tested on its own (scripts/test-migrate-plan.mts).
 */

/** Tabs where every row is its own record (history). Nothing in them may be lost in the copy. */
export const HISTORY_TABS = new Set([
  "events",
  "hardware_updates",
  "qc_checks",
  "rig_reports",
  "receipt_edits",
  "deletions",
]);

const norm = (s: string) => s.trim().toLowerCase();

export interface SheetRead {
  rows: Row[];
  /** Headings in the sheet that the app does not know: their values are NOT copied. */
  unknownColumns: string[];
  /** App columns with no heading in the sheet: copied as blank. */
  missingColumns: string[];
}

/**
 * Turn raw sheet values (row 0 = headings) into rows, matching columns by heading name, not position,
 * so a moved or inserted column cannot shift values into the wrong field. Rows with a blank key are skipped.
 */
export function rowsFromSheet(values: unknown[][], columns: readonly string[]): SheetRead {
  const header = (values[0] ?? []).map((h) => String(h ?? ""));
  const at = new Map<string, number>();
  header.forEach((h, i) => {
    const k = norm(h);
    if (k && !at.has(k)) at.set(k, i);
  });

  const known = new Set(columns.map(norm));
  const unknownColumns = header.filter((h) => h.trim() && !known.has(norm(h)));
  const missingColumns = columns.filter((c) => !at.has(norm(c)));

  // A sheet with no headings at all: fall back to the app's column order.
  const index = (c: string, i: number) => (at.size ? at.get(norm(c)) : i);

  const rows: Row[] = [];
  for (const raw of values.slice(at.size ? 1 : 0)) {
    const row: Row = {};
    columns.forEach((c, i) => {
      const j = index(c, i);
      row[c] = j === undefined ? "" : String(raw[j] ?? "").trim() === "" ? "" : String(raw[j]);
    });
    if (row[columns[0]].trim() === "") continue;
    rows.push(row);
  }
  return { rows, unknownColumns, missingColumns };
}

export interface Dedupe {
  rows: Row[];
  /** History rows that shared an ID with a different row and were kept under a new ID. */
  renamed: { from: string; to: string }[];
  /** Exact copies (every column the same) that were kept once. */
  exactCopies: number;
  /** Lookup rows replaced by a later row with the same ID (last wins, like the app). */
  replaced: string[];
}

/**
 * Make IDs unique for the database.
 *
 * History tabs: nothing is lost. Exact copies are kept once. Different rows with the same ID are all
 * kept; the extra ones get "~2", "~3"… on their ID. The original ID stays on `preferredKeeper` (for
 * events: the row an item points to as its last event), otherwise on the last such row, which is the
 * one the app shows today. Rows keep their sheet order (oldest first).
 *
 * Other tabs: the last row with an ID wins, as before.
 */
export function dedupe(
  tab: string,
  rows: Row[],
  key: string,
  preferredKeeper?: (row: Row) => boolean,
): Dedupe {
  if (!HISTORY_TABS.has(tab)) {
    const byKey = new Map<string, Row>();
    const replaced = new Set<string>();
    for (const r of rows) {
      if (byKey.has(r[key])) replaced.add(r[key]);
      byKey.delete(r[key]);
      byKey.set(r[key], r);
    }
    return { rows: [...byKey.values()], renamed: [], exactCopies: 0, replaced: [...replaced] };
  }

  const sig = (r: Row) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const g = groups.get(r[key]);
    if (g) g.push(i);
    else groups.set(r[key], [i]);
  });

  const used = new Set(rows.map((r) => r[key]));
  const drop = new Set<number>();
  const rename = new Map<number, string>();
  const renamed: { from: string; to: string }[] = [];
  let exactCopies = 0;

  for (const [id, idx] of groups) {
    if (idx.length === 1) continue;

    // Exact copies: keep the first of each distinct row.
    const seen = new Set<string>();
    const distinct: number[] = [];
    for (const i of idx) {
      const s = sig(rows[i]);
      if (seen.has(s)) {
        drop.add(i);
        exactCopies++;
      } else {
        seen.add(s);
        distinct.push(i);
      }
    }
    if (distinct.length === 1) continue;

    const preferred = preferredKeeper ? distinct.filter((i) => preferredKeeper(rows[i])) : [];
    const keeper = (preferred.length ? preferred : distinct)[(preferred.length ? preferred : distinct).length - 1];

    let n = 2;
    for (const i of distinct) {
      if (i === keeper) continue;
      let to = `${id}~${n++}`;
      while (used.has(to)) to = `${id}~${n++}`;
      used.add(to);
      rename.set(i, to);
      renamed.push({ from: id, to });
    }
  }

  const out: Row[] = [];
  rows.forEach((r, i) => {
    if (drop.has(i)) return;
    const to = rename.get(i);
    out.push(to ? { ...r, [key]: to } : r);
  });
  return { rows: out, renamed, exactCopies, replaced: [] };
}
