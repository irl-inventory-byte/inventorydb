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

export interface Fold {
  /** Rows whose attributes got the value (it was missing there). */
  filled: number;
  /** Rows where attributes already had the same value. */
  same: number;
  /** Rows where attributes had a DIFFERENT value: the attributes value (what the app shows) was kept. */
  differed: string[];
}

/**
 * Move an extra sheet column (e.g. "Card Type") into each row's `attributes` JSON under `attrKey`
 * (e.g. card_type), where the app actually reads it. Only fills a blank or missing value; a value the
 * app already has is never changed. Changes `rows` in place. `values` is the raw tab (row 0 = headings).
 */
export function foldColumnIntoAttributes(
  values: unknown[][],
  rows: Row[],
  key: string,
  heading: string,
  attrKey: string,
  clean: (v: string) => string = (v) => v.trim(),
): Fold {
  const header = (values[0] ?? []).map((h) => norm(String(h ?? "")));
  const col = header.indexOf(norm(heading));
  const keyCol = header.indexOf(norm(key));
  const out: Fold = { filled: 0, same: 0, differed: [] };
  if (col < 0 || keyCol < 0) return out;

  // Same rule as the copy: the last sheet row for an ID gives its value.
  const fromSheet = new Map<string, string>();
  for (const raw of values.slice(1)) {
    const id = String(raw[keyCol] ?? "");
    const v = clean(String(raw[col] ?? ""));
    if (id.trim() && v) fromSheet.set(id, v);
  }

  for (const r of rows) {
    const v = fromSheet.get(r[key]);
    if (!v) continue;
    let attrs: Record<string, unknown> = {};
    try {
      const parsed = r.attributes ? JSON.parse(r.attributes) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) attrs = parsed as Record<string, unknown>;
      else continue; // not the usual JSON: leave it alone
    } catch {
      continue;
    }
    const have = typeof attrs[attrKey] === "string" ? (attrs[attrKey] as string).trim() : "";
    if (!have) {
      attrs[attrKey] = v;
      r.attributes = JSON.stringify(attrs);
      out.filled++;
    } else if (have.toLowerCase() === v.toLowerCase()) out.same++;
    else out.differed.push(r[key]);
  }
  return out;
}

/** "black", " GREEN " → "Black", "Green" (the values the app accepts); anything else as typed. */
export const cleanCardType = (v: string) => {
  const t = v.trim().toLowerCase();
  return t === "black" || t === "black card" ? "Black" : t === "green" || t === "green card" ? "Green" : v.trim();
};

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
 * Other tabs: one row per ID. With `preferredKeeper`, the FIRST row it accepts is kept (e.g. for users:
 * the first active row, which is the one the app signs people in with); otherwise the last row wins.
 */
export function dedupe(
  tab: string,
  rows: Row[],
  key: string,
  preferredKeeper?: (row: Row) => boolean,
): Dedupe {
  if (!HISTORY_TABS.has(tab)) {
    const groups = new Map<string, number[]>();
    rows.forEach((r, i) => {
      const g = groups.get(r[key]);
      if (g) g.push(i);
      else groups.set(r[key], [i]);
    });
    const keep = new Set<number>();
    const replaced: string[] = [];
    for (const [id, idx] of groups) {
      if (idx.length > 1) replaced.push(id);
      const preferred = preferredKeeper ? idx.find((i) => preferredKeeper(rows[i])) : undefined;
      keep.add(preferred ?? idx[idx.length - 1]);
    }
    return { rows: rows.filter((_, i) => keep.has(i)), renamed: [], exactCopies: 0, replaced };
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
