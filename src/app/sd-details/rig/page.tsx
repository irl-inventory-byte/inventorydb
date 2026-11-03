import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import { getStore } from "@/lib/store";
import styles from "../../admin/admin.module.css";
import SdDetailsForm from "../SdDetailsForm";
import { saveSdDetails } from "../actions";

/**
 * Rig team SD card details — admin and the rig role (which covers both the Rig team and the
 * Productivity team; they're two hubs under the same "rig" role, not separate roles — see
 * lib/rig-hub.ts). See src/app/sd-details/SdDetailsForm.tsx / actions.ts.
 */
export default async function RigSdDetailsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "rig");
  const sp = await searchParams;

  const store = getStore();
  const [people, hubs, all] = await Promise.all([
    store.list("people"),
    store.list("hubs"),
    store.list("sd_card_durations"),
  ]);

  const memberOptions = people
    .filter((p) => p.role === "rig" && p.active !== "false")
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

  const recent = all
    .filter((r) => r.team === "rig")
    .sort((a, b) => Date.parse(b.recorded_at || "0") - Date.parse(a.recorded_at || "0"))
    .slice(0, 50);

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/">← Home</Link>
      </p>
      <h1>Rig team SD card details</h1>
      <p className={styles.muted}>SD Card Duration Hour — recorded here and also sent to the Google Sheet.</p>

      <SdDetailsForm
        team="rig"
        action={saveSdDetails}
        memberLabel="Rig team name"
        memberOptions={memberOptions}
        foIfoOptions={foIfoOptions}
        cities={cities}
        saved={one(sp.saved) === "1"}
        error={one(sp.error)}
        recent={recent}
      />
    </main>
  );
}