import Link from "next/link";
import type { CSSProperties } from "react";
import type { Hub, Item } from "@/lib/schema";
import { BarList, n, type BarRow } from "./charts";
import styles from "./dashboard.module.css";
import { Icon, type IconName } from "./icons";

const OUT_OF_USE = new Set(["lost", "damaged", "retired"]);
const TOP = 8;

/** A mobile's saved details (Asset Tag, Serial, Model No., Category, Storage). */
function details(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")]));
    }
  } catch {
    // no details
  }
  return {};
}

const list = (params: Record<string, string> = {}) => `/inventory?${new URLSearchParams({ type: "mobile", ...params })}`;

/** Count mobiles by a label, biggest first; the rest are summed into one "other" bar. */
function bars(items: Item[], labelOf: (i: Item) => string, what: string, href: (label: string) => string): BarRow[] {
  const count = new Map<string, number>();
  for (const i of items) {
    const label = labelOf(i).trim() || "Not set";
    count.set(label, (count.get(label) ?? 0) + 1);
  }
  const sorted = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rows: BarRow[] = sorted.slice(0, TOP).map(([label, value]) => ({
    key: label,
    label,
    value,
    href: href(label),
    tip: `${label}\n${n(value)} ${value === 1 ? "mobile" : "mobiles"}`,
  }));
  const rest = sorted.slice(TOP);
  if (rest.length) {
    const value = rest.reduce((s, [, v]) => s + v, 0);
    rows.push({ key: "other", label: `${rest.length} other ${what}`, value, href: list(), tip: `${rest.length} other ${what}\n${n(value)} mobiles` });
  }
  return rows;
}

/** Dashboard → Mobile: tiles and simple breakdowns. Mobiles are not sent or received, so no movement charts. */
export function MobileOverview({ items, hubs }: { items: Item[]; hubs: Hub[] }) {
  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const inUse = items.filter((i) => !OUT_OF_USE.has(i.status));
  const totalCost = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const noCost = items.filter((i) => !(Number(i.price) > 0)).length;
  const outOfUse = items.length - inUse.length;
  const inStock = items.filter((i) => i.status === "in_stock").length;
  const share = (v: number) => (items.length ? `${Math.round((v / items.length) * 100)}% of all mobiles` : "No mobiles yet");

  const tiles: { label: string; value: string; hint: string; href: string; icon: IconName; color: string }[] = [
    { label: "Total mobiles", value: n(items.length), hint: `${n(inUse.length)} in use`, href: list(), icon: "layers", color: "var(--series-1)" },
    { label: "In stock", value: n(inStock), hint: share(inStock), href: list({ status: "in_stock" }), icon: "check", color: "var(--series-3)" },
    {
      label: "Total cost",
      value: `₹${n(totalCost)}`,
      hint: noCost ? `${n(noCost)} without a cost` : "All mobiles have a cost",
      href: list(),
      icon: "chart",
      color: "var(--series-2)",
    },
    { label: "Lost, damaged or retired", value: n(outOfUse), hint: outOfUse ? share(outOfUse) : "Out of use", href: list({ status: "lost,damaged,retired" }), icon: "alert", color: "var(--critical)" },
  ];

  const byCategory = bars(items, (i) => details(i.attributes)["Category"] ?? "", "categories", (l) => list({ q: l }));
  const byMaker = bars(items, (i) => i.brand, "manufacturers", (l) => list({ q: l }));
  const byModel = bars(items, (i) => i.model, "models", (l) => list({ q: l }));
  const byHub = bars(items, (i) => hubName.get(i.current_hub) ?? i.current_hub, "hubs", (l) => {
    const hub = hubs.find((h) => h.name === l);
    return hub ? list({ hub: hub.hub_id }) : list();
  });

  return (
    <>
      <section className={`${styles.kpiGrid} kpi-sd`} aria-label="Mobiles overview">
        <style>{`
.kpi-sd.kpi-sd{display:flex;flex-wrap:wrap;gap:12px}
.kpi-sd.kpi-sd > *{flex:1 1 230px;min-width:0}
.kpi-sd.kpi-sd > * span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`}</style>
        {tiles.map((k) => (
          <Link key={k.label} href={k.href} className={styles.kpi} style={{ "--kpi": k.color } as CSSProperties}>
            <span className={styles.kpiIcon}>
              <Icon name={k.icon} size={22} />
            </span>
            <span className={styles.kpiBody}>
              <span className={styles.kpiLabel}>{k.label}</span>
              <span className={styles.kpiValue}>{k.value}</span>
              <span className={styles.kpiHint}>{k.hint}</span>
            </span>
          </Link>
        ))}
      </section>

      {items.length === 0 ? (
        <section className={styles.card}>
          <p className={styles.muted}>
            No mobiles yet. An Admin or IM adds them in Inventory → Mobile → + Add a mobile, by scanning the phone&apos;s
            QR code (IMEI).
          </p>
        </section>
      ) : (
        <>
          <div className={styles.chartRow}>
            <section className={styles.card} aria-label="Mobiles by category">
              <h2>By category</h2>
              <BarList rows={byCategory} />
            </section>
            <section className={styles.card} aria-label="Mobiles by manufacturer">
              <h2>By manufacturer</h2>
              <BarList rows={byMaker} />
            </section>
          </div>
          <div className={styles.chartRow}>
            <section className={styles.card} aria-label="Mobiles by model">
              <h2>By model</h2>
              <BarList rows={byModel} />
            </section>
            <section className={styles.card} aria-label="Mobiles by hub">
              <h2>By hub</h2>
              <BarList rows={byHub} />
            </section>
          </div>
        </>
      )}

      <p className={styles.muted}>
        <Link href={list()} className={styles.link}>
          See every mobile in Inventory
        </Link>{" "}
        — IMEI, Asset Tag, Serial, Model, Category, Storage and Cost.
      </p>
    </>
  );
}