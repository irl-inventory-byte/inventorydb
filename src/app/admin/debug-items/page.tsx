import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";

// TEMPORARY diagnostic page — not linked from anywhere in the UI, admin-only.
// Shows the raw character codes of every stored item_id so a mismatch (en-dash vs hyphen,
// non-breaking space, trailing space, etc.) that looks identical on screen can be spotted.
// Safe to delete this whole folder once the 404 bug is found and fixed.
export default async function DebugItemsPage() {
  await requireRole("admin");

  const store = getStore();
  // getStore() returns the unnarrowed store (same as /inventory/[id] and /inventory/[id]/delete use),
  // so this sees exactly the same "items" rows those pages look up against.
  const items = await store.list("items");

  const rows = items.map((item) => {
    const id = item.item_id ?? "";
    const codes = Array.from(id).map((ch) => ch.codePointAt(0)!.toString(16).padStart(4, "0"));
    return {
      item_id: id,
      length: id.length,
      codes: codes.join(" "),
      hasOddChar: /[^\x20-\x7E]/.test(id) || / {2,}/.test(id) || id !== id.trim(),
      item_type: item.item_type,
    };
  });

  rows.sort((a, b) => a.item_id.localeCompare(b.item_id));

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 24, fontFamily: "monospace" }}>
      <h1 style={{ fontFamily: "sans-serif" }}>Debug: raw item_id values</h1>
      <p style={{ fontFamily: "sans-serif" }}>
        {rows.length} items total. Rows flagged <strong>ODD</strong> contain a character outside plain
        ASCII, a double space, or leading/trailing whitespace — any of these makes the stored ID NOT
        equal to the string you'd expect from looking at it, which is exactly what causes a 404 on
        <code> /inventory/[id]</code> even though the row clearly exists in the list.
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #333" }}>
            <th style={{ padding: 6 }}>Flag</th>
            <th style={{ padding: 6 }}>Type</th>
            <th style={{ padding: 6 }}>item_id (as displayed)</th>
            <th style={{ padding: 6 }}>Length</th>
            <th style={{ padding: 6 }}>Hex code points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              style={{
                borderBottom: "1px solid #ddd",
                background: r.hasOddChar ? "#fff1f0" : undefined,
              }}
            >
              <td style={{ padding: 6, color: "#b91c1c", fontWeight: 700 }}>
                {r.hasOddChar ? "ODD" : ""}
              </td>
              <td style={{ padding: 6 }}>{r.item_type}</td>
              <td style={{ padding: 6, overflowWrap: "anywhere" }}>{r.item_id}</td>
              <td style={{ padding: 6 }}>{r.length}</td>
              <td style={{ padding: 6, overflowWrap: "anywhere" }}>{r.codes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}