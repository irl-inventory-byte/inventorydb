import Form from "next/form";
import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import { storeForAll } from "@/lib/access";
import { formatIst } from "@/lib/time";
import styles from "../admin/admin.module.css";
import { TypeBadge, TypeCounts } from "../ItemTypeBadge";

/**
 * Search by FO number (an FO/IFO's person_id), mobile number, or name, and see everything they
 * currently hold: total count, a breakdown by item type, and each item's ID, status and hub.
 *
 * Only CURRENTLY assigned items ever show here. This isn't a separate filter — items.current_holder
 * is cleared the moment an item is received back into stock (see lib/handover.ts), so an item that was
 * returned or transferred away from this FO simply stops matching, automatically.
 */
export default async function FoAssetsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined } | Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireRole();
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const qLower = q.toLowerCase();
  const qDigits = q.replace(/\D/g, "");

  const store = storeForAll(user.role);
  const [people, hubs, items] = await Promise.all([
    store.list("people"),
    store.list("hubs"),
    store.list("items"),
  ]);

  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));

  // FOs and IFOs are searched the same way (both are field-facing roles items get sent to elsewhere
  // in the app — see the Role/Name filter on /inventory). An exact FO number match always wins, even
  // if the typed text also happens to appear in another person's name.
  const fos = people.filter((p) => p.role === "fo" || p.role === "ifo");
  const exact = fos.find((p) => p.person_id.toLowerCase() === qLower);
  const candidates = exact
    ? [exact]
    : q
      ? fos.filter(
          (p) =>
            p.person_id.toLowerCase().includes(qLower) ||
            p.name.toLowerCase().includes(qLower) ||
            (qDigits.length >= 4 && (p.mobile ?? "").includes(qDigits)),
        )
      : [];

  const selectedId = one(sp.fo) || (candidates.length === 1 ? candidates[0].person_id : "");
  const selected = selectedId ? people.find((p) => p.person_id === selectedId) : undefined;

  const assigned = selected ? items.filter((i) => i.current_holder === selected.person_id) : [];

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/">← Home</Link>
      </p>

      <div className={styles.pageHead}>
        <h1>FO Assets</h1>
      </div>

      <p className={styles.muted}>
        Search by FO number, mobile number or name to see everything they currently hold. Only
        currently assigned items show here — anything returned or transferred drops off automatically.
      </p>

      <Form action="/fo-assets" className={styles.row} scroll={false} data-progress="1">
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <strong style={{ fontWeight: 600 }}>FO number</strong>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="FO number, mobile or name"
            aria-label="FO number, mobile or name"
            autoFocus
          />
        </label>
        <button type="submit">Search</button>
        {q && <Link href="/fo-assets">Clear</Link>}
      </Form>

      {q && candidates.length === 0 && (
        <p className={styles.error}>No FO or IFO matches &quot;{q}&quot;.</p>
      )}

      {q && !selected && candidates.length > 1 && (
        <>
          <p className={styles.muted}>{candidates.length} matches — pick one:</p>
          <ul className={styles.list}>
            {candidates.map((p) => (
              <li key={p.person_id}>
                <Link href={`/fo-assets?q=${encodeURIComponent(q)}&fo=${encodeURIComponent(p.person_id)}`}>
                  {p.name} ({ROLE_LABELS[p.role] ?? p.role}) — {p.person_id}
                  {p.mobile ? ` · ${p.mobile}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {selected && (
        <>
          <div className={styles.details} style={{ padding: 16, marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>
              {selected.name}{" "}
              <span className={styles.muted}>
                ({ROLE_LABELS[selected.role] ?? selected.role} · {selected.person_id})
              </span>
            </h2>
            {selected.mobile && <p className={styles.muted}>Mobile: {selected.mobile}</p>}
            <p style={{ fontSize: 18, fontWeight: 700, margin: "8px 0" }}>
              {assigned.length} asset{assigned.length === 1 ? "" : "s"} currently assigned
            </p>
            <TypeCounts types={assigned.map((i) => i.item_type)} />
          </div>

          {assigned.length === 0 ? (
            <p className={styles.muted}>No assets currently assigned to {selected.name}.</p>
          ) : (
            <div
              role="region"
              aria-label="Assigned assets"
              tabIndex={0}
              style={{ width: "100%", maxWidth: "100%", overflowX: "auto" }}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Asset ID / Serial</th>
                    <th scope="col">Brand</th>
                    <th scope="col">Model</th>
                    <th scope="col">Status</th>
                    <th scope="col">Current hub</th>
                    <th scope="col">Since</th>
                  </tr>
                </thead>
                <tbody>
                  {assigned
                    .slice()
                    .sort((a, b) => a.item_type.localeCompare(b.item_type) || a.item_id.localeCompare(b.item_id))
                    .map((item) => (
                      <tr key={item.item_id}>
                        <td>
                          <TypeBadge type={item.item_type} />
                        </td>
                        <td>
                          <Link href={`/inventory/${encodeURIComponent(item.item_id)}`}>{item.item_id}</Link>
                        </td>
                        <td>{item.brand || "—"}</td>
                        <td>{item.model || "—"}</td>
                        <td>{STATUS_LABELS[item.status] ?? item.status}</td>
                        <td>{hubName.get(item.current_hub) ?? item.current_hub}</td>
                        <td>{item.updated_at ? `${formatIst(item.updated_at)} IST` : "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}