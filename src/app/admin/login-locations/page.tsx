import { requireRole } from "@/lib/authz";
import { ROLE_LABELS } from "@/lib/labels";
import { getStore } from "@/lib/store";
import { formatIst } from "@/lib/time";
import styles from "../admin.module.css";
import BackLink from "../../BackLink";
import LoginLocationsTable, { type LoginLocationRow } from "./LoginLocationsTable";

/**
 * Admin-only log of where each sign-in happened. Rows come from the "login_locations" tab, written by
 * app/api/login-location/route.ts right after a successful login — only when the person's browser
 * granted the location permission prompt (see app/GeoCapture.tsx). A login with no row simply means
 * the prompt was declined, timed out, or unsupported — never an error.
 */
export default async function LoginLocationsPage() {
  await requireRole("admin");

  const store = getStore();
  // The tab is created on first capture, so it may not exist yet on a brand-new deploy.
  const locations = await store.list("login_locations").catch(() => []);

  const rows: LoginLocationRow[] = [...locations]
    .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at))
    .map((l) => ({
      id: l.login_location_id,
      when: formatIst(l.recorded_at),
      email: l.email,
      role: ROLE_LABELS[l.role as keyof typeof ROLE_LABELS] ?? l.role,
      address: l.address,
      mapUrl: l.latitude && l.longitude ? `https://www.google.com/maps?q=${l.latitude},${l.longitude}` : "",
    }));

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <BackLink />
      </p>

      <h1>Login Locations</h1>

      <p className={styles.muted}>
        Where each sign-in happened, from the browser&apos;s own location prompt right after login.
        Only logged when the person allows the prompt — declined or unsupported browsers leave no row,
        which is expected, not an error. {rows.length} capture{rows.length === 1 ? "" : "s"}.
      </p>

      <LoginLocationsTable rows={rows} />
    </main>
  );
}