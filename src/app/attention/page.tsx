import Link from "next/link";
import type { CSSProperties } from "react";
import { requireRole } from "@/lib/authz";
import { LATE_AFTER_HOURS, computeDashboard } from "@/lib/dashboard";
import { ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import type { Item, Status } from "@/lib/schema";
import { allowedTypes, storeFor, typeParam } from "@/lib/access";
import { formatIst, istDate } from "@/lib/time";
import { getStore } from "@/lib/store";
import styles from "../dashboard/dashboard.module.css";
import { addDelayNote, deleteDelayNote } from "../dashboard/actions";
import { n } from "../dashboard/charts";

/**
 * "Needs attention" as its own page (not nested inside /dashboard), reached from the Home tile.
 * Admin and IM only. Shows ONLY late/delayed items — an FO, IFO, rig team, internal or hardware
 * person holding something past LATE_AFTER_HOURS, or a hub a card was sent to and never received —
 * with a date range, city and role filter, and a CSV download of whatever's currently shown.
 *
 * This duplicates (rather than imports) the small slice of /dashboard's "Needs attention" logic it
 * needs — computeDashboard's d.late, plus the senders/cities/hours-out helpers below — so this page
 * has its own data fetch and doesn't depend on the rest of that very large file.
 */

const TYPE_LABELS: Record<string, string> = { sd_card: "SD cards", rig: "Rigs", mobile: "Mobiles", power_bank: "Power Banks" };
const TYPE_NAME: Record<string, string> = { sd_card: "SD card", rig: "Rig", mobile: "Mobile" };

const TH_STYLE: CSSProperties = { position: "sticky", top: 0, zIndex: 2, backgroundColor: "#1e293b", color: "#ffffff" };
const TFOOT_STYLE: CSSProperties = {
  position: "static",
  borderTop: "2px solid #64748b",
  backgroundColor: "#1e293b",
  color: "#ffffff",
  fontWeight: 700,
};
const GLYPH = { warning: "▲" } as const;

// One row in the table: one person/hub holding late items, or (after flattening) one late item.
interface Attention {
  key: string;
  person: string;
  role: string;
  city: string;
  sentBy: string;
  items: number;
  hours: number | null;
  outFor: string;
  issue: string;
  href: string;
  late?: Item[];
}

const inventory = (params: Record<string, string>) => `/inventory?${new URLSearchParams(params)}`;

export default async function NeedsAttentionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("admin", "im");
  const sp = await searchParams;

  // Unlike /dashboard (which defaults to the first type it can see, e.g. SD cards, because of its
  // type-switch tab), this page defaults to every type the login can see — "only late items" means
  // all of them, not just whichever tab happened to be selected. ?type=rig etc. still narrows it,
  // for the links coming in from the dashboard's KPI tiles.
  const type = typeParam(one(sp.type), user.role);
  const store = storeFor(user.role, type);
  const rigView = type === "rig";
  const mobileView = type === "mobile";
  const powerBankView = type === "power_bank";
  const typeNoun = rigView ? "rigs" : mobileView ? "mobiles" : powerBankView ? "power banks" : type === "sd_card" ? "cards" : "items";

  const [items, events, people, hubs, delayNotes] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("people"),
    store.list("hubs"),
    getStore().list("delay_notes").catch(() => []),
  ]);
  const now = new Date();
  const d = computeDashboard(items, events, people, hubs, { hub: "", days: 14, now });

  // ---- Needs attention: one row per person/hub holding late items (same logic as /dashboard) ----
  const howLong = (hours: number) => (hours < 48 ? `${Math.floor(hours)} hours` : `${Math.floor(hours / 24)} days`);
  const attention: Attention[] = [];
  const seen = new Set<string>();

  const hubCity = new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));
  const holderCities = new Map<string, Set<string>>();
  for (const i of items) {
    if (!i.current_holder || i.status === "in_stock") continue;
    const set = holderCities.get(i.current_holder) ?? new Set<string>();
    set.add(hubCity.get(i.current_hub) ?? i.current_hub);
    holderCities.set(i.current_holder, set);
  }
  const personHub = new Map(people.map((p) => [p.person_id, p.hub]));

  const eventById = new Map(events.map((e) => [e.event_id, e]));
  const personName = new Map(people.map((p) => [p.person_id, p.name]));
  const senders = (list: typeof items) => {
    const count = new Map<string, number>();
    for (const i of list) {
      const e = eventById.get(i.last_event_id);
      const who = (e?.from_person || personName.get(e?.from_id ?? "") || e?.from_id || "").trim();
      if (who) count.set(who, (count.get(who) ?? 0) + 1);
    }
    const sorted = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (sorted.length === 0) return "—";
    if (sorted.length === 1) return sorted[0][0];
    const shown = sorted.slice(0, 3).map(([who, c]) => `${who} (${c})`).join(", ");
    return sorted.length > 3 ? `${shown} +${sorted.length - 3} more` : shown;
  };
  const lastMove = new Map<string, number>();
  for (const e of events) {
    const t = Date.parse(e.occurred_at);
    if (!Number.isNaN(t) && t > (lastMove.get(e.item_id) ?? -Infinity)) lastMove.set(e.item_id, t);
  }
  const hoursOut = (i: (typeof items)[number]) => {
    const t = lastMove.get(i.item_id) ?? Date.parse(i.updated_at);
    return Number.isNaN(t) ? 0 : Math.max(0, (now.getTime() - t) / 3_600_000);
  };
  const isLate = (i: (typeof items)[number]) => hoursOut(i) > LATE_AFTER_HOURS;
  const lateWith = (id: string, status: Status) => items.filter((i) => i.current_holder === id && i.status === status && isLate(i));
  const sentToPerson = (id: string, status: Status) => senders(lateWith(id, status));
  const sentToHub = (hubId: string) => senders(items.filter((i) => i.status === "pending" && i.current_hub === hubId && isLate(i)));
  const cityOfPerson = (id: string, status: Status) => {
    const late = [...new Set(lateWith(id, status).map((i) => hubCity.get(i.current_hub) ?? i.current_hub))].filter(Boolean);
    if (late.length) return late.sort().join(", ");
    const set = holderCities.get(id);
    if (set && set.size) return [...set].filter(Boolean).sort().join(", ");
    const hub = personHub.get(id);
    return hub ? (hubCity.get(hub) ?? hub) : "—";
  };

  for (const g of d.late) {
    seen.add(g.key);
    if (g.kind === "pending") {
      attention.push({
        key: `late-pending-${g.key}`,
        person: g.label,
        role: "Hub",
        city: hubCity.get(g.key) ?? g.key,
        sentBy: sentToHub(g.key),
        items: g.count,
        hours: g.oldestHours,
        outFor: howLong(g.oldestHours),
        issue: "Sent, not received",
        href: `/handover/receive?${new URLSearchParams({ hub: g.key })}`,
        late: items.filter((i) => i.status === "pending" && i.current_hub === g.key && isLate(i)),
      });
    } else {
      attention.push({
        key: `late-${g.kind}-${g.key}`,
        person: g.label,
        role: g.kind === "fo" ? "FO" : "IFO",
        city: cityOfPerson(g.key, g.kind === "fo" ? "with_fo" : "traveling"),
        sentBy: sentToPerson(g.key, g.kind === "fo" ? "with_fo" : "traveling"),
        items: g.count,
        hours: g.oldestHours,
        outFor: howLong(g.oldestHours),
        issue: g.kind === "fo" ? "Not returned" : "Not arrived",
        href: inventory({ holder: g.key, status: g.kind === "fo" ? "with_fo" : "traveling" }),
        late: lateWith(g.key, g.kind === "fo" ? "with_fo" : "traveling"),
      });
    }
  }

  const heldBy = new Map<string, { status: Status; count: number; hours: number }>();
  for (const i of items) {
    if (i.status !== "with_rig" && i.status !== "with_internal") continue;
    if (!i.current_holder || seen.has(i.current_holder)) continue;
    const hours = hoursOut(i);
    if (hours <= LATE_AFTER_HOURS) continue;
    const g = heldBy.get(i.current_holder) ?? { status: i.status, count: 0, hours: 0 };
    g.count++;
    g.hours = Math.max(g.hours, hours);
    heldBy.set(i.current_holder, g);
  }
  for (const [personId, g] of heldBy) {
    const person = people.find((p) => p.person_id === personId);
    attention.push({
      key: `late-held-${personId}`,
      person: person?.name ?? personId,
      role: person ? ROLE_LABELS[person.role] : g.status === "with_rig" ? "Rig team" : "Internal",
      city: cityOfPerson(personId, g.status),
      sentBy: sentToPerson(personId, g.status),
      items: g.count,
      hours: g.hours,
      outFor: howLong(g.hours),
      issue: "Not returned",
      href: inventory({ holder: personId, status: g.status }),
      late: lateWith(personId, g.status),
    });
  }

  const heldByHardware = new Map<string, { count: number; hours: number }>();
  for (const i of items) {
    if (i.status !== "with_hardware") continue;
    if (!i.current_holder || seen.has(i.current_holder)) continue;
    const hours = hoursOut(i);
    if (hours <= LATE_AFTER_HOURS) continue;
    const g = heldByHardware.get(i.current_holder) ?? { count: 0, hours: 0 };
    g.count++;
    g.hours = Math.max(g.hours, hours);
    heldByHardware.set(i.current_holder, g);
  }
  for (const [personId, g] of heldByHardware) {
    const person = people.find((p) => p.person_id === personId);
    attention.push({
      key: `late-hardware-${personId}`,
      person: person?.name ?? personId,
      role: person ? ROLE_LABELS[person.role] : "Hardware",
      city: cityOfPerson(personId, "with_hardware"),
      sentBy: sentToPerson(personId, "with_hardware"),
      items: g.count,
      hours: g.hours,
      outFor: howLong(g.hours),
      issue: "Not sent to IM",
      href: inventory({ holder: personId, status: "with_hardware" }),
      late: lateWith(personId, "with_hardware"),
    });
  }

  attention.sort((a, b) => (b.hours ?? -1) - (a.hours ?? -1) || b.items - a.items);

  // One row per delayed card. sentOnLabel is what's shown ("21 Nov 2026"); sentOnIso ("2026-11-21")
  // is what the date filter and the Count-grouping actually compare against — the two must stay
  // separate, since the display format isn't in date order.
  const delayed = attention
    .flatMap((a) =>
      (a.late ?? []).map((i) => {
        const e = eventById.get(i.last_event_id);
        const sentAt = lastMove.get(i.item_id) ?? Date.parse(i.updated_at);
        const sentOk = !Number.isNaN(sentAt);
        return {
          id: i.item_id,
          type: TYPE_NAME[i.item_type] ?? i.item_type,
          person: a.person,
          role: a.role,
          city: hubCity.get(i.current_hub) ?? i.current_hub,
          sentBy: (e?.from_person || personName.get(e?.from_id ?? "") || e?.from_id || "—").trim() || "—",
          sentOnIso: sentOk ? istDate(new Date(sentAt)) : "",
          sentOnLabel: sentOk
            ? new Date(sentAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })
            : "—",
          sentAt: sentOk ? formatIst(new Date(sentAt).toISOString()) : "—",
          status: STATUS_LABELS[i.status] ?? i.status,
          hours: hoursOut(i),
          issue: a.issue,
        };
      }),
    )
    .sort((x, y) => y.hours - x.hours || x.id.localeCompare(y.id));

  // Date filter (?from=&to=), by the day each item last moved (sentOnIso, a sortable YYYY-MM-DD).
  const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const dfrom = isDay(one(sp.from)) ? one(sp.from) : "";
  const dto = isDay(one(sp.to)) ? one(sp.to) : "";
  const delayedInRange =
    dfrom || dto ? delayed.filter((r) => (!dfrom || r.sentOnIso >= dfrom) && (!dto || r.sentOnIso <= dto)) : delayed;

  // City and role filters (several allowed, comma separated: ?city=Bangalore,Pune&role=FO,IFO).
  // City choices: active hubs only, plus any city a delayed item is actually sitting in right now
  // (even at an inactive hub — it still needs to show up so that item isn't invisible to the filter).
  const activeHubCities = hubs.filter((h) => h.active !== "false").map((h) => (h.city || h.name || h.hub_id).trim());
  const cityOptions = [...new Set([...activeHubCities, ...delayedInRange.map((r) => r.city)].filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  // Always offer Rig team / Productivity team as choices, even when nothing of theirs is currently
  // late — same reasoning as the city list: a filter option shouldn't disappear just because today
  // there's nothing to show for it.
  const roleOptions = [...new Set([...delayedInRange.map((r) => r.role), "Rig team", "Productivity team"].filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
  const listParam = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
  const cityFilter = listParam(one(sp.city));
  const roleFilter = listParam(one(sp.role));
  const matchesFilter = (r: (typeof delayed)[number]) =>
    (cityFilter.length === 0 || cityFilter.includes(r.city)) && (roleFilter.length === 0 || roleFilter.includes(r.role));

  // Same type/person/role/city/sender/send-date → one row with a Count. Oldest first.
  const groups = new Map<string, (typeof delayed)[number] & { count: number; key: string; items: (typeof delayed)[number][] }>();
  for (const r of delayedInRange) {
    if (!matchesFilter(r)) continue;
    const k = [r.type, r.person, r.role, r.city, r.sentBy, r.sentOnIso, r.issue].join("|");
    const g = groups.get(k);
    if (g) {
      g.count++;
      g.hours = Math.max(g.hours, r.hours);
      g.items.push(r);
    } else groups.set(k, { ...r, count: 1, key: k, items: [r] });
  }
  const shownDelayed = [...groups.values()].sort((x, y) => y.hours - x.hours || y.count - x.count);

  const detailKey = one(sp.detail);
  const detailRow = shownDelayed.find((g) => g.key === detailKey);
  const keep: Record<string, string> = {};
  if (type) keep.type = type;
  if (cityFilter.length) keep.city = cityFilter.join(",");
  if (roleFilter.length) keep.role = roleFilter.join(",");
  if (dfrom) keep.from = dfrom;
  if (dto) keep.to = dto;
  const detailHref = (key: string) => `/attention?${new URLSearchParams({ ...keep, detail: key })}#delayed-items`;
  const closeDetailHref = `/attention?${new URLSearchParams(keep)}`;

  // PDF export data: one row per delayed item, respecting every filter above.
  const exportRows = delayedInRange.filter(matchesFilter);
  const csvRows = [
    ["Item ID", "Type", "Person", "Role", "City", "Sent by", "Sent on", "Out for", "Status", "Issue"],
    ...exportRows.map((r) => [r.id, r.type, r.person, r.role, r.city, r.sentBy, r.sentOnLabel, howLong(r.hours), r.status, r.issue]),
  ];

  const delayNoteLog = delayNotes.slice().sort((a, b) => Date.parse(b.recorded_at || "0") - Date.parse(a.recorded_at || "0"));
  const latestNoteByItem = new Map<string, (typeof delayNoteLog)[number]>();
  for (const note of delayNoteLog) if (!latestNoteByItem.has(note.item_id)) latestNoteByItem.set(note.item_id, note);

  const typeOptions = allowedTypes(user.role);

  return (
    <div className={styles.root}>
      <main className={styles.wrap}>
        <p className={styles.back}>
          <Link href="/">← Home</Link>
        </p>

        <section className={styles.card} id="attention" aria-label="Needs attention" style={{ minWidth: 0 }}>
          <h2>Needs attention</h2>
          <p className={styles.muted}>
            Only delayed cards: each item an FO, IFO, rig team, internal or hardware person has held, or that was sent to
            a hub and not received, for more than {LATE_AFTER_HOURS} hours since its last send or receive. Cards with the
            same person, sender and send date are one row; Count = how many. Oldest first. Click a name or the Count to
            see only those delayed items. Only late items ever show here — nothing in stock or on time.
          </p>

          {typeOptions.length > 1 && (
            <p style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "0 0 10px", fontSize: "0.85rem" }}>
              <Link href="/attention" className={!type ? styles.link : undefined} style={!type ? { fontWeight: 700 } : undefined}>
                All
              </Link>
              {typeOptions.map((t) => (
                <Link
                  key={t}
                  href={`/attention?${new URLSearchParams({ type: t })}`}
                  className={type === t ? styles.link : undefined}
                  style={type === t ? { fontWeight: 700 } : undefined}
                >
                  {TYPE_LABELS[t] ?? t}
                </Link>
              ))}
            </p>
          )}

          <form
            id="needsAttentionFilters"
            method="GET"
            action="/attention"
            style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", margin: "4px 0 14px" }}
          >
            {type && <input type="hidden" name="type" value={type} />}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <strong style={{ fontWeight: 600, fontSize: "0.85rem" }}>City</strong>
              <select name="city" defaultValue={cityFilter[0] ?? ""} aria-label="City" data-auto-apply="1">
                <option value="">All cities</option>
                {cityOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <strong style={{ fontWeight: 600, fontSize: "0.85rem" }}>Role</strong>
              <select name="role" defaultValue={roleFilter[0] ?? ""} aria-label="Role" data-auto-apply="1">
                <option value="">All roles</option>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <strong style={{ fontWeight: 600, fontSize: "0.85rem" }}>From</strong>
              <input type="date" name="from" defaultValue={dfrom} max={dto || undefined} aria-label="From date" data-auto-apply="1" />
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <strong style={{ fontWeight: 600, fontSize: "0.85rem" }}>To</strong>
              <input type="date" name="to" defaultValue={dto} min={dfrom || undefined} aria-label="To date" data-auto-apply="1" />
            </label>
            <button type="submit" style={{ padding: "4px 10px", fontSize: "0.85rem" }}>
              Apply
            </button>
            {(dfrom || dto || cityFilter.length || roleFilter.length) && (
              <Link
                href={`/attention${type ? `?${new URLSearchParams({ type })}` : ""}`}
                className={styles.link}
                style={{ fontSize: "0.85rem" }}
              >
                Clear filters
              </Link>
            )}
            <button
              type="button"
              id="downloadPdfBtn"
              className={styles.link}
              style={{
                marginLeft: "auto",
                fontSize: "0.85rem",
                whiteSpace: "nowrap",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                font: "inherit",
              }}
            >
              ⬇ Download PDF{dfrom || dto || cityFilter.length || roleFilter.length ? " (filtered)" : ""}
            </button>
          </form>

          {/* Data for the PDF export below: one row per delayed item, respecting every filter above
              (same rows the CSV export used to cover). Read by the script tag further down. */}
          <script
            type="application/json"
            id="attentionExportData"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: JSON.stringify(csvRows) }}
          />

          {/* Auto-apply: picking a city/role, or finishing a date, reloads the page with that
              filter right away — so the exported PDF (built from the URL's filters) always
              matches what's currently selected, without needing a separate click on Apply first. */}
          <script
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: `
                (function () {
                  var form = document.getElementById("needsAttentionFilters");
                  if (!form) return;
                  var fields = form.querySelectorAll('[data-auto-apply="1"]');
                  fields.forEach(function (el) {
                    el.addEventListener("change", function () {
                      if (typeof form.requestSubmit === "function") form.requestSubmit();
                      else form.submit();
                    });
                  });
                })();
              `,
            }}
          />

          {/* Download PDF: loads jsPDF + its autotable plugin from a CDN on first click, then
              renders the filtered table (same data the old CSV export used) into a landscape PDF. */}
          <script
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: `
                (function () {
                  var btn = document.getElementById("downloadPdfBtn");
                  if (!btn) return;
                  function loadScript(src) {
                    return new Promise(function (resolve, reject) {
                      var s = document.createElement("script");
                      s.src = src;
                      s.onload = resolve;
                      s.onerror = reject;
                      document.head.appendChild(s);
                    });
                  }
                  function ensureLibs() {
                    return Promise.resolve()
                      .then(function () {
                        if (!window.jspdf) {
                          return loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js");
                        }
                      })
                      .then(function () {
                        if (!(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable)) {
                          return loadScript(
                            "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
                          );
                        }
                      });
                  }
                  // Start fetching the PDF library right away, in the background, instead of
                  // waiting for the click — so by the time someone actually hits the button, it's
                  // almost always already loaded and the PDF comes out immediately.
                  var scriptsLoaded = ensureLibs();
                  btn.addEventListener("click", function () {
                    var original = btn.textContent;
                    btn.textContent = "Preparing…";
                    btn.disabled = true;
                    scriptsLoaded
                      .then(function () {
                        var dataEl = document.getElementById("attentionExportData");
                        var rows = JSON.parse(dataEl.textContent || "[]");
                        var head = [rows[0] || []];
                        var body = rows.slice(1);
                        var jsPDF = window.jspdf.jsPDF;
                        var doc = new jsPDF({ orientation: "landscape" });
                        doc.setFontSize(14);
                        doc.text("Needs attention — delayed items", 14, 14);
                        doc.autoTable({
                          head: head,
                          body: body,
                          startY: 20,
                          styles: { fontSize: 8, cellPadding: 2 },
                          headStyles: { fillColor: [30, 41, 59] },
                          margin: { left: 10, right: 10 },
                        });
                        doc.save("attention.pdf");
                      })
                      .catch(function () {
                        window.alert("Couldn't load the PDF library — check your internet connection and try again.");
                      })
                      .finally(function () {
                        btn.textContent = original;
                        btn.disabled = false;
                      });
                  });
                })();
              `,
            }}
          />

          {delayedInRange.length > 0 && shownDelayed.length === 0 ? (
            <p className={styles.muted}>Nothing matches this filter.</p>
          ) : delayedInRange.length === 0 ? (
            <p className={styles.ok}>
              <span className={`${styles.icon} ${styles.iconGood}`} aria-hidden>
                ✓
              </span>{" "}
              No delayed {typeNoun} right now.
            </p>
          ) : (
            <div
              className={styles.tableScroll}
              role="region"
              aria-label="Delayed cards — scrollable table"
              tabIndex={0}
              style={{ maxHeight: "560px", maxWidth: "100%", overflowY: "auto", overflowX: "auto" }}
            >
              <table className={styles.table} style={{ width: "100%", minWidth: "900px", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    {["Type", "Person", "Role", "City", "Sent by", "Sent on", "Count", "Out for", "Note", "Issue", "Action"].map((h) => (
                      <th key={h} scope="col" style={TH_STYLE}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shownDelayed.map((r) => {
                    const itemNotes = r.items
                      .map((it) => latestNoteByItem.get(it.id))
                      .filter((note): note is NonNullable<typeof note> => !!note && !!note.note.trim());
                    const distinctNotes = new Set(itemNotes.map((note) => note.note.trim()));
                    const actionTaken = itemNotes.length > 0;
                    const existing = itemNotes[0];
                    const forItem = r.items.length === 1 ? r.items[0]?.id : (existing?.item_id ?? r.items[0]?.id);
                    const showInline = distinctNotes.size <= 1;
                    return (
                      <tr key={r.key} style={r.key === detailKey ? { background: "#eff6ff" } : undefined}>
                        <td>{r.type}</td>
                        <td style={{ whiteSpace: "normal" }}>
                          <Link href={detailHref(r.key)} title="Show only these delayed items">
                            {r.person}
                          </Link>
                        </td>
                        <td>{r.role}</td>
                        <td>{r.city}</td>
                        <td style={{ whiteSpace: "normal" }}>{r.sentBy}</td>
                        <td>{r.sentOnLabel}</td>
                        <td className={styles.num}>
                          <Link href={detailHref(r.key)} className={styles.link} title="Show only these delayed items">
                            {n(r.count)}
                          </Link>
                        </td>
                        <td>{howLong(r.hours)}</td>
                        <td style={{ minWidth: 180 }}>
                          {!forItem ? (
                            <span className={styles.muted}>—</span>
                          ) : !showInline ? (
                            <Link href={detailHref(r.key)} className={styles.link} style={{ fontSize: "0.78rem" }}>
                              {itemNotes.length} of {r.items.length} noted — view individually
                            </Link>
                          ) : (
                            <form action={addDelayNote} style={{ display: "flex", gap: 4 }} data-progress="1">
                              <input type="hidden" name="item_id" value={forItem} />
                              <input type="hidden" name="item_type" value={r.type} />
                              <input type="hidden" name="person" value={r.person} />
                              <input type="hidden" name="sent_by" value={r.sentBy} />
                              <input
                                name="note"
                                defaultValue={existing?.note ?? ""}
                                placeholder="Add a note…"
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  padding: "3px 6px",
                                  border: "1px solid var(--border)",
                                  borderRadius: 6,
                                  background: "var(--surface-1)",
                                  color: "var(--text-primary)",
                                  fontSize: "0.8rem",
                                }}
                              />
                              <button type="submit" style={{ padding: "3px 8px", fontSize: "0.78rem" }}>
                                Save
                              </button>
                            </form>
                          )}
                        </td>
                        <td>
                          <span className={`${styles.icon} ${styles.iconWarning}`} aria-hidden>
                            {GLYPH.warning}
                          </span>{" "}
                          {r.issue}
                        </td>
                        <td>
                          {actionTaken ? (
                            <span style={{ color: "#16a34a", fontWeight: 600 }}>Action taken</span>
                          ) : (
                            <span style={{ color: "#dc2626", fontWeight: 600 }}>Action pending</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot style={{ position: "static" }}>
                  <tr>
                    <th scope="row" colSpan={6} style={{ ...TFOOT_STYLE, textAlign: "left" }}>
                      Total delayed cards
                    </th>
                    <td className={styles.num} style={TFOOT_STYLE}>
                      {n(shownDelayed.reduce((t, r) => t + r.count, 0))}
                    </td>
                    <td colSpan={4} style={TFOOT_STYLE}>
                      {n(shownDelayed.length)} row{shownDelayed.length === 1 ? "" : "s"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {detailRow && (
            <div id="delayed-items" style={{ marginTop: 20, scrollMarginTop: 80 }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <h3 style={{ margin: 0 }}>
                  Delayed items — {detailRow.person} ({detailRow.role}) · sent by {detailRow.sentBy} on {detailRow.sentOnLabel} ·{" "}
                  {n(detailRow.items.length)}
                </h3>
                <Link href={closeDetailHref} className={styles.link}>
                  Close
                </Link>
              </div>
              <p className={styles.muted} style={{ margin: "4px 0 10px" }}>
                Only these items: out for more than {LATE_AFTER_HOURS} hours since their last send or receive. Oldest first.
              </p>
              <div
                className={styles.tableScroll}
                role="region"
                aria-label="Delayed items — scrollable table"
                tabIndex={0}
                style={{ maxHeight: "420px", maxWidth: "100%", overflowY: "auto", overflowX: "auto" }}
              >
                <table className={styles.table} style={{ width: "100%", minWidth: "980px", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      {["Item ID", "Type", "City", "Sent by", "Sent at", "Out for", "Status", "Note"].map((h) => (
                        <th key={h} scope="col" style={TH_STYLE}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detailRow.items.map((it) => (
                      <tr key={it.id}>
                        <td>
                          <Link href={`/inventory/${encodeURIComponent(it.id)}`} className={styles.link}>
                            {it.id}
                          </Link>
                        </td>
                        <td>{it.type}</td>
                        <td>{it.city}</td>
                        <td>{it.sentBy}</td>
                        <td>{it.sentAt}</td>
                        <td>{howLong(it.hours)}</td>
                        <td>{it.status}</td>
                        <td style={{ minWidth: 220 }}>
                          {(() => {
                            const existingNote = latestNoteByItem.get(it.id);
                            return (
                              <div style={{ display: "flex", gap: 6 }}>
                                <form action={addDelayNote} style={{ display: "flex", gap: 6, flex: 1, minWidth: 0 }} data-progress="1">
                                  <input type="hidden" name="item_id" value={it.id} />
                                  <input type="hidden" name="item_type" value={it.type} />
                                  <input type="hidden" name="person" value={detailRow.person} />
                                  <input type="hidden" name="sent_by" value={it.sentBy} />
                                  <input
                                    name="note"
                                    required
                                    defaultValue={existingNote?.note ?? ""}
                                    placeholder="Add a note…"
                                    style={{
                                      flex: 1,
                                      minWidth: 0,
                                      padding: "4px 8px",
                                      border: "1px solid var(--border)",
                                      borderRadius: 6,
                                      background: "var(--surface-1)",
                                      color: "var(--text-primary)",
                                      fontSize: "0.85rem",
                                    }}
                                  />
                                  <button type="submit" style={{ padding: "4px 10px", fontSize: "0.85rem" }}>
                                    Save
                                  </button>
                                </form>
                                {existingNote && (
                                  <form action={deleteDelayNote} data-progress="1">
                                    <input type="hidden" name="note_id" value={existingNote.note_id} />
                                    <button
                                      type="submit"
                                      title="Delete this note"
                                      style={{
                                        padding: "4px 10px",
                                        fontSize: "0.85rem",
                                        color: "#dc2626",
                                        border: "1px solid var(--border)",
                                        borderRadius: 6,
                                        background: "var(--surface-1)",
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </form>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {delayNoteLog.length > 0 && (
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
              <h3 style={{ margin: "0 0 10px" }}>Delay notes ({delayNoteLog.length})</h3>
              <div
                className={styles.tableScroll}
                role="region"
                aria-label="Delay notes — scrollable table"
                tabIndex={0}
                style={{ maxHeight: "360px", maxWidth: "100%", overflowY: "auto", overflowX: "auto" }}
              >
                <table className={styles.table} style={{ width: "100%", minWidth: "760px", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      {["Date", "Item", "Item ID", "Person", "With whom", "Note", ""].map((h) => (
                        <th key={h} scope="col" style={TH_STYLE}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {delayNoteLog.map((note) => (
                      <tr key={note.note_id}>
                        <td>{note.recorded_at ? formatIst(note.recorded_at) : "—"}</td>
                        <td>{note.item_type || "—"}</td>
                        <td>
                          <Link href={`/inventory/${encodeURIComponent(note.item_id)}`} className={styles.link}>
                            {note.item_id}
                          </Link>
                        </td>
                        <td>{note.person || "—"}</td>
                        <td>{note.sent_by || "—"}</td>
                        <td style={{ whiteSpace: "normal" }}>{note.note}</td>
                        <td>
                          <form action={deleteDelayNote} data-progress="1">
                            <input type="hidden" name="note_id" value={note.note_id} />
                            <button
                              type="submit"
                              title="Delete this note"
                              style={{
                                padding: "3px 8px",
                                fontSize: "0.78rem",
                                color: "#dc2626",
                                border: "1px solid var(--border)",
                                borderRadius: 6,
                                background: "var(--surface-1)",
                              }}
                            >
                              Delete
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}