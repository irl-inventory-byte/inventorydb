import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import { getStore } from "@/lib/store";
import styles from "../../admin/admin.module.css";
import SdDetailsForm from "../SdDetailsForm";
import { saveSdDetails } from "../actions";
import Link from "next/link";

/** Rig SD card details — admin and Rig team only. See src/app/sd-details/SdDetailsForm.tsx / actions.ts. */
export default async function RigSdDetailsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[]; error?: string | string[] }>;
}) {
  const user = await requireRole("admin", "rig");
  const sp = await searchParams;

  const store = getStore();
  const [people, hubs, all] = await Promise.all([
    store.list("people"),
    store.list("hubs"),
    store.list("sd_card_durations"),
  ]);

  // Rig team and Productivity team members both carry the "rig" role (see lib/rig-hub.ts) — which
  // pool they're sending for on a given day is chosen on the form itself (the Team dropdown), not by
  // who they are.
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

  // Pre-select the logged-in person's own name, if they're a Rig team member themselves (not when an
  // admin not listed on the Rig team is filling this in on someone else's behalf).
  const defaultMember = memberOptions.find((m) => m.id === user.personId)?.name ?? "";

  const recent = all
    .filter((r) => r.team === "rig")
    .sort((a, b) => Date.parse(b.recorded_at || "0") - Date.parse(a.recorded_at || "0"))
    .slice(0, 50);

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/sd-details">Back</Link>
      </p>
      <h1>Rig SD card details</h1>
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
        defaultMember={defaultMember}
      />
    </main>
  );
}