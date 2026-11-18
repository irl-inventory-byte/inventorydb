import Form from "next/form";
import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import { storeForAll } from "@/lib/access";
import { formatIst, istDate } from "@/lib/time";
import styles from "../admin/admin.module.css";
import { TypeBadge, TypeCounts } from "../ItemTypeBadge";
import FoNamePicker from "./FoNamePicker";
import FoDirectory from "./FoDirectory";

/**
 * Admin/IM only. Shows every FO/IFO with their mobile number and current asset total up front (the
 * directory table — filter it yourself, client-side, no searching one at a time required), plus a
 * dropdown-based search for drilling into one person's full item-by-item breakdown, optionally
 * narrowed by role/city and a From/To assigned-date range.
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
  const user = await requireRole("admin", "im");
  const sp = await searchParams;

  const roleFilter = one(sp.role) === "fo" || one(sp.role) === "ifo" ? one(sp.role) : "";
  const cityFilter = one(sp.city).trim().toLowerCase();
  const selectedId = one(sp.fo);
  const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isDay(one(sp.from)) ? one(sp.from) : "";
  const to = isDay(one(sp.to)) ? one(sp.to) : "";

  const store = storeForAll(user.role);
  const [people, hubs, items] = await Promise.all([
    store.list("people"),
    store.list("hubs"),
    store.list("items"),
  ]);

  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));

  // A hub's city: its city, or its name when the city is blank (same rule as /inventory).
  const cityLabelOf = (h: (typeof hubs)[number]) => (h.city ?? "").trim() || h.name.trim();
  const hubCity = new Map(hubs.map((h) => [h.hub_id, cityLabelOf(h).toLowerCase()]));
  const cityOptions = [...new Map(hubs.map((h) => [cityLabelOf(h).toLowerCase(), cityLabelOf(h)])).entries()]
    .filter(([key]) => key)
    .sort((a, b) => a[1].localeCompare(b[1]));

  // Every FO and IFO, sorted by name. The City dropdown narrows the Name dropdown client-side (see
  // FoNamePicker) rather than through a page reload, so this list is NOT pre-filtered by city here —
  // `fos` below (server-side, for the "x FO/IFO in that city" count) still is.
  const allFos = people
    .filter((p) => p.role === "fo" || p.role === "ifo")
    .sort((a, b) => a.name.localeCompare(b.name));
  const fos = allFos.filter(
    (p) => (!roleFilter || p.role === roleFilter) && (!cityFilter || hubCity.get(p.hub) === cityFilter),
  );

  // Current assigned items, grouped by holder, computed once for every FO/IFO — this feeds both the
  // directory table's Total/Breakdown columns and the single-person detail section below.
  const assignedByFo = new Map<string, typeof items>();
  for (const it of items) {
    if (!it.current_holder) continue;
    const list = assignedByFo.get(it.current_holder) ?? [];
    list.push(it);
    assignedByFo.set(it.current_holder, list);
  }

  const directory = allFos.map((p) => {
    const list = assignedByFo.get(p.person_id) ?? [];
    return {
      id: p.person_id,
      name: p.name,
      mobile: p.mobile ?? "",
      roleLabel: ROLE_LABELS[p.role] ?? p.role,
      hub: hubName.get(p.hub) ?? p.hub,
      city: hubCity.get(p.hub) ?? "",
      total: list.length,
      types: list.map((i) => i.item_type),
    };
  });

  const selected = selectedId ? people.find((p) => p.person_id === selectedId) : undefined;

  const assigned = selected
    ? items.filter((i) => {
        if (i.current_holder !== selected.person_id) return false;
        if (!from && !to) return true;
        const day = i.updated_at ? istDate(new Date(Date.parse(i.updated_at))) : "";
        return (!from || (day !== "" && day >= from)) && (!to || (day !== "" && day <= to));
      })
    : [];

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/">← Home</Link>
      </p>

      <div className={styles.pageHead}>
        <h1>FO Assets</h1>
      </div>

      <p className={styles.muted}>
        Every FO/IFO, their mobile number, and what they currently hold — filter the table yourself,
        or use the search below to drill into one person&apos;s full item-by-item list. Only currently
        assigned items show here — anything returned or transferred drops off automatically.
      </p>

      <FoDirectory rows={directory} selectedId={selectedId} />

      <Form action="/fo-assets" className={styles.row} scroll={false} data-progress="1">
        <FoNamePicker
          fos={allFos.map((p) => ({
            id: p.person_id,
            name: p.name,
            mobile: p.mobile ?? "",
            roleRaw: p.role as "fo" | "ifo",
            roleLabel: ROLE_LABELS[p.role] ?? p.role,
            hub: hubName.get(p.hub) ?? p.hub,
            city: hubCity.get(p.hub) ?? "",
          }))}
          cityOptions={cityOptions.map(([value, label]) => ({ value, label }))}
          defaultRole={roleFilter}
          defaultCity={cityFilter}
          defaultFo={selectedId}
        />

        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <strong style={{ fontWeight: 600 }}>From</strong>
          <input type="date" name="from" defaultValue={from} max={to || undefined} aria-label="From date" />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <strong style={{ fontWeight: 600 }}>To</strong>
          <input type="date" name="to" defaultValue={to} min={from || undefined} aria-label="To date" />
        </label>

        <button type="submit">Search</button>
        {(selectedId || roleFilter || cityFilter || from || to) && <Link href="/fo-assets">Clear</Link>}
      </Form>

      {!selectedId && (
        <p className={styles.muted}>
          {roleFilter || cityFilter ? `${fos.length} match${fos.length === 1 ? "" : "es"}. ` : ""}Choose a name above to see their assets.
        </p>
      )}

      {selectedId && !selected && <p className={styles.error}>That FO/IFO could not be found.</p>}

      {selected && (
        <>
          <div className={styles.details} style={{ padding: 16, marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>
              {selected.name}{" "}
              <span className={styles.muted}>
                ({ROLE_LABELS[selected.role] ?? selected.role} · {hubName.get(selected.hub) ?? selected.hub})
              </span>
            </h2>
            {selected.mobile && <p className={styles.muted}>Mobile: {selected.mobile}</p>}
            {(from || to) && (
              <p className={styles.muted}>
                Assigned {from ? `from ${from}` : ""} {to ? `to ${to}` : ""}
              </p>
            )}
            <p style={{ fontSize: 18, fontWeight: 700, margin: "8px 0" }}>
              {assigned.length} asset{assigned.length === 1 ? "" : "s"} currently assigned
            </p>
            <TypeCounts types={assigned.map((i) => i.item_type)} />
          </div>

          {assigned.length === 0 ? (
            <p className={styles.muted}>No assets currently assigned to {selected.name}{(from || to) ? " in that date range" : ""}.</p>
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