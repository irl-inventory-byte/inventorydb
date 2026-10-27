import Link from "next/link";
import { storeFor } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { QC_LABELS, one } from "@/lib/labels";
import { QC_STATUSES, type HardwareUpdate, type QcCheck } from "@/lib/schema";
import {
  auditParams,
  auditPeople,
  auditTotals,
  auditUpdateTypes,
  buildAuditEntries,
  filterAuditEntries,
  isEmptyFilter,
  readAuditFilter,
  resultLabel,
} from "@/lib/rig-audit";
import { formatIst } from "@/lib/time";
import styles from "../../admin/admin.module.css";

const QC_COLOR: Record<string, string> = {
  pass: "#15803D",
  repaired: "#15803D",
  fail: "#B42318",
  qc_pending: "#8A4B00",
};

// Entries shown per page. The CSV download always holds every matching row.
const PAGE_SIZE = 200;

function numberText(value: number): string {
  return value.toLocaleString("en-IN");
}

/**
 * QC & HARDWARE AUDIT TRAIL: every QC result and hardware update ever recorded,
 * filterable by date, person, rig and result, with a CSV download.
 *
 * Read-only. Results and updates are still recorded on the rig's own page.
 */
export default async function RigAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("admin", "im", "hardware", "qc");
  const sp = await searchParams;
  const filter = readAuditFilter((key) => one(sp[key]));

  const store = storeFor(user.role, "rig");
  const [items, qcChecks, hardwareUpdates] = await Promise.all([
    store.list("items"),
    store.list("qc_checks").catch(() => [] as QcCheck[]),
    store.list("hardware_updates").catch(() => [] as HardwareUpdate[]),
  ]);

  const all = buildAuditEntries({ items, qcChecks, hardwareUpdates });
  const shown = filterAuditEntries(all, filter);
  const totals = auditTotals(shown);

  // The dropdowns list whoever and whatever is actually in the data.
  const people = auditPeople(all);
  const updateTypes = auditUpdateTypes(all);

  // Paging keeps the filter.
  const requestedPage = Number(one(sp.page));
  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(
    totalPages,
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  );
  const pageRows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const pageHref = (n: number) => {
    const q = auditParams(filter, { page: String(n) });
    return q ? `/rigs/audit?${q}` : "/rigs/audit";
  };

  const csvHref = () => {
    const q = auditParams(filter);
    return q ? `/rigs/audit/export?${q}` : "/rigs/audit/export";
  };

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/">← Home</Link> · <Link href="/rigs">Rig checks</Link>
      </p>

      <div className={styles.pageHead}>
        <h1>QC &amp; hardware audit trail</h1>

        <div className={styles.row}>
          <a href={csvHref()} className={styles.back}>
            Download CSV
          </a>
        </div>
      </div>

      <p className={styles.muted}>
        Every QC result and hardware update that has been recorded, newest first. Times are IST.
        {isEmptyFilter(filter) ? "" : " Filtered."} Record new results on a rig&apos;s own page from{" "}
        <Link href="/rigs">Rig checks</Link>.
      </p>

      {/* Summary of whatever is currently filtered in. */}
      <p className={styles.muted}>
        <strong>{numberText(totals.entries)}</strong> entries ·{" "}
        {numberText(totals.qc)} QC results ({numberText(totals.pass)} pass, {numberText(totals.fail)} fail) ·{" "}
        {numberText(totals.hardware)} hardware updates · {numberText(totals.rigs)} rigs ·{" "}
        {numberText(totals.people)} people
      </p>

      <form className={styles.row} method="get" aria-label="Filter the audit trail">
        <label>
          From
          <input type="date" name="from" defaultValue={filter.from} />
        </label>

        <label>
          To
          <input type="date" name="to" defaultValue={filter.to} />
        </label>

        <label>
          Type
          <select name="kind" defaultValue={filter.kind}>
            <option value="">QC and hardware</option>
            <option value="qc">QC results</option>
            <option value="hardware">Hardware updates</option>
          </select>
        </label>

        <label>
          Result
          <select name="result" defaultValue={filter.result}>
            <option value="">Any result</option>
            <optgroup label="QC">
              {QC_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {QC_LABELS[status] ?? status}
                </option>
              ))}
            </optgroup>
            {updateTypes.length > 0 && (
              <optgroup label="Hardware update">
                {updateTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <label>
          Person
          <select name="person" defaultValue={filter.person}>
            <option value="">Anyone</option>
            {people.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name} ({numberText(p.count)})
              </option>
            ))}
          </select>
        </label>

        <input
          name="q"
          defaultValue={filter.q}
          placeholder="Rig ID, prism no., brand or model"
          aria-label="Search rigs"
        />

        <button type="submit">Apply</button>

        {!isEmptyFilter(filter) && (
          <Link href="/rigs/audit" className={styles.back}>
            Clear
          </Link>
        )}
      </form>

      {shown.length === 0 ? (
        <p className={styles.muted}>
          {all.length === 0
            ? "Nothing has been recorded yet. QC results and hardware updates appear here as soon as they are saved."
            : "No entries match these filters."}
        </p>
      ) : (
        <>
          <p className={styles.muted}>
            Showing {numberText((page - 1) * PAGE_SIZE + 1)}–
            {numberText((page - 1) * PAGE_SIZE + pageRows.length)} of {numberText(shown.length)}.
          </p>

          <div role="region" aria-label="Audit trail" tabIndex={0} style={{ overflowX: "auto" }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Recorded at (IST)</th>
                  <th scope="col">Type</th>
                  <th scope="col">Rig</th>
                  <th scope="col">Prism no.</th>
                  <th scope="col">Brand / Model</th>
                  <th scope="col">Result</th>
                  <th scope="col">Comment</th>
                  <th scope="col">Recorded by</th>
                </tr>
              </thead>

              <tbody>
                {pageRows.map((entry) => (
                  <tr key={`${entry.kind}-${entry.id}`}>
                    <td>{entry.at ? formatIst(entry.at) : "—"}</td>
                    <td>{entry.kind === "qc" ? "QC result" : "Hardware update"}</td>

                    <td>
                      <Link href={`/inventory/${encodeURIComponent(entry.itemId)}`}>{entry.itemId}</Link>
                    </td>

                    <td>{entry.prism || "—"}</td>
                    <td>{[entry.brand, entry.model].filter(Boolean).join(" ") || "—"}</td>

                    <td
                      style={
                        entry.kind === "qc"
                          ? { color: QC_COLOR[entry.result], fontWeight: 600 }
                          : undefined
                      }
                    >
                      {resultLabel(entry)}
                    </td>

                    <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{entry.comment || "—"}</td>
                    <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{entry.byName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className={styles.row}>
              {page > 1 && <Link href={pageHref(page - 1)}>← Previous</Link>}
              <span className={styles.muted}>
                Page {page} of {totalPages}
              </span>
              {page < totalPages && <Link href={pageHref(page + 1)}>Next →</Link>}
            </div>
          )}
        </>
      )}
    </main>
  );
}