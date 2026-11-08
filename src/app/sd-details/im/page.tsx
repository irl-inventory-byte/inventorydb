import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import { getStore } from "@/lib/store";
import styles from "../../admin/admin.module.css";
import SdDetailsForm from "../SdDetailsForm";
import { saveSdDetails } from "../actions";

/** IM SD card details — admin and IM only. See src/app/sd-details/SdDetailsForm.tsx / actions.ts. */
export default async function ImSdDetailsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "im");
  const sp = await searchParams;

  const store = getStore();
  const [people, hubs, all] = await Promise.all([
    store.list("people"),
    store.list("hubs"),
    store.list("sd_card_durations"),
  ]);

  const memberOptions = people
    .filter((p) => p.role === "im" && p.active !== "false")
    .map((p) => ({ id: p.person_id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const foIfoOptions = people
    .filter((p) => (p.role === "fo" || p.role === "ifo") && p.active !== "false")
    .map((p) => ({ id: p.person_id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byCity = new Map<string, { id: string; name: string }[]>();
  for (const h of hubs.filter((h) => h.active !== "false")) {
    const city = (h.city || h.name || h.hub_id).trim();
    if (!byCity.has(city)) byCity.set(city, []);
    byCity.get(city)!.push({ id: h.hub_id, name: h.name });
  }
  const cities = [...byCity.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Recent-entries filter bar: date range (on card_date) + exact match on member/FO-IFO/city/IC.
  const filterFrom = one(sp.from);
  const filterTo = one(sp.to);
  const filterMember = one(sp.member);
  const filterFoIfo = one(sp.foIfo);
  const filterCity = one(sp.city);
  const filterIc = one(sp.ic);

  const recent = all
    .filter((r) => r.team === "im")
    .filter((r) => !filterFrom || r.card_date >= filterFrom)
    .filter((r) => !filterTo || r.card_date <= filterTo)
    .filter((r) => !filterMember || r.team_member === filterMember)
    .filter((r) => !filterFoIfo || r.fo_ifo === filterFoIfo)
    .filter((r) => !filterCity || r.city === filterCity)
    .filter((r) => !filterIc || r.ic_name === filterIc)
    .sort((a, b) => Date.parse(b.recorded_at || "0") - Date.parse(a.recorded_at || "0"))
    .slice(0, 50);

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/">← Home</Link>
      </p>
      <h1>IM SD card details</h1>
      <p className={styles.muted}>SD Card Duration Hour — recorded here and also sent to the Google Sheet.</p>

      <SdDetailsForm
        team="im"
        action={saveSdDetails}
        memberLabel="IM"
        memberOptions={memberOptions}
        foIfoOptions={foIfoOptions}
        cities={cities}
        saved={one(sp.saved) === "1"}
        error={one(sp.error)}
        recent={recent}
        filters={{
          from: filterFrom,
          to: filterTo,
          member: filterMember,
          foIfo: filterFoIfo,
          city: filterCity,
          ic: filterIc,
        }}
      />
    </main>
  );
}