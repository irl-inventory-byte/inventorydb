import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { toDataURL as qrToDataURL } from "qrcode";
import { requireRole } from "@/lib/authz";
import { formatPrice, summarizeBatch } from "@/lib/receipt";
import { VIEW_ROLES, storeFor } from "@/lib/access";
import { formatIst } from "@/lib/time";
import styles from "../../form.module.css";
import PrintButton from "./PrintButton";

// One row on the receipt (same shape as summary.items).
type ReceiptItem = NonNullable<ReturnType<typeof summarizeBatch>>["items"][number];

const ACTION_TITLE: Record<string, string> = {
  check_out: "Handover receipt",
  receive: "Return receipt",
  correct: "Correction record",
};

// Next.js serves public/Instawork.svg at this URL.
// The path is case-sensitive on Vercel, so the capital "I" must match the file name.
const RECEIPT_LOGO = "/Instawork.svg";

/** Read a string field from a store record, or "" if missing. */
function field(record: unknown, name: string): string {
  if (record && typeof record === "object" && name in record) {
    const value = (record as Record<string, unknown>)[name];
    return value == null ? "" : String(value);
  }
  return "";
}

const looksLikeEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() ===
  b.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Email for a person on the receipt, from the people database.
 * Order:
 *   1. the id itself, when an admin's email was recorded as the id
 *   2. the person's linked_user (the email saved on the People page)
 *   3. the email of the user account linked to that person_id
 * The person is found by person_id, or by name for older handovers
 * that were saved without an id.
 */
function lookupEmail(
  personId: unknown,
  personName: unknown,
  people: readonly unknown[],
  users: readonly unknown[]
): string {
  const id = personId == null ? "" : String(personId).trim();
  const name = personName == null ? "" : String(personName).trim();

  if (looksLikeEmail(id)) return id;

  const person =
    (id && people.find((p) => field(p, "person_id") === id)) ||
    (name && people.find((p) => sameName(field(p, "name"), name))) ||
    undefined;

  const linked = field(person, "linked_user").trim();
  if (looksLikeEmail(linked)) return linked;

  const pid = field(person, "person_id") || id;
  const user = pid
    ? users.find(
        (u) =>
          field(u, "person_id") === pid &&
          field(u, "active") !== "false"
      )
    : undefined;
  const userEmail = field(user, "email").trim();

  return looksLikeEmail(userEmail) ? userEmail : "";
}

/**
 * Build the receipt URL used in the QR code.
 */
async function baseUrl() {
  const h = await headers();

  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    "localhost:3000";

  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");

  return `${proto}://${host}`;
}

export default async function ReceiptPage({
  params,
}: PageProps<"/handover/receipt/[batch]">) {
  const me = await requireRole(...VIEW_ROLES);

  const { batch } = await params;
  const store = storeFor(me.role);

  const [events, items, hubs, people, users] = await Promise.all([
    store.list("events"),
    store.list("items"),
    store.list("hubs"),
    store.list("people"),
    store.list("users"),
  ]);

  const summary = summarizeBatch(events, items, hubs, batch);

  if (!summary) {
    notFound();
  }

  // QR CODE GENERATION:
  // The code points to this batch's receipt.
  const receiptUrl =
    `${await baseUrl()}/handover/receipt/` +
    encodeURIComponent(summary.batchId);

  const qr = await qrToDataURL(receiptUrl, {
    margin: 1,
    width: 220,
  });

  // Missing prices must not be displayed as zero.
  const missingPriceCount = summary.items.filter(
    (item) => formatPrice(item.price) === ""
  ).length;

  // Count by storage size, e.g. "256 GB × 20, 512 GB × 6".
  const storageCounts = new Map<string, number>();
  for (const item of summary.items) {
    const key = item.storage || "Not set";
    storageCounts.set(key, (storageCounts.get(key) ?? 0) + 1);
  }
  const storageBreakdown = [...storageCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([size, count]) => `${size} × ${count}`)
    .join(", ");

  const itemCountLabel = `${summary.items.length} item${
    summary.items.length === 1 ? "" : "s"
  }`;

  const totalLabel =
    missingPriceCount > 0 && summary.totalPrice !== null
      ? "Known penalty amounts subtotal"
      : "Total listed penalty amount";

  const totalValue =
    summary.totalPrice !== null
      ? formatPrice(String(summary.totalPrice))
      : "Not set";

  // Return receipts only: what was sent, what came back, what is still out.
  const ret = summary.returnInfo;
  const missingCount = ret?.missing.length ?? 0;
  const returnTotalLabel =
    ret && ret.missingWithoutPrice > 0 && missingCount > 0
      ? "Known penalty amounts subtotal"
      : "Total penalty (items not returned)";

  const fromLocation = summary.fromHubName || "—";
  const toLocation = summary.hubName || "—";

  // Email IDs of the people on the receipt (blank if not linked).
  const peopleList = people as readonly unknown[];
  const userList = users as readonly unknown[];
  const fromEmail = lookupEmail(summary.fromId, summary.fromName, peopleList, userList);
  const toEmail = lookupEmail(summary.toId, summary.toName, peopleList, userList);

  return (
    <main className={styles.page}>
      {/* Hidden in printed/PDF output. */}
      <p className={`${styles.back} ${styles.noPrint}`}>
        <Link href="/handover/send">← Send items</Link>
      </p>

      <div className={styles.receipt}>
        {/* Receipt header: logo and title left, QR right. */}
        <div
          className={styles.receiptHead}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 20,
            breakInside: "avoid",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 220px" }}>
            {/* RECEIPT LOGO ONLY:
                File location: public/Instawork.svg
                No website link is attached.
                This image is inside the printable receipt. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- local receipt logo */}
            <img
              src={RECEIPT_LOGO}
              alt="Instawork"
              width={180}
              height={48}
              loading="eager"
              style={{
                display: "block",
                width: 180,
                maxWidth: "100%",
                height: "auto",
                marginBottom: 16,
              }}
            />

            <h1>{ACTION_TITLE[summary.action] ?? "Batch record"}</h1>

            <p className={styles.muted}>
              Batch {summary.batchId} · {formatIst(summary.occurredAt)} IST
            </p>
          </div>

          {/* QR CODE DISPLAY:
              Scan this code when receiving the batch. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- generated QR data URI */}
          <img
            src={qr}
            alt={`QR code for batch ${summary.batchId}`}
            width={140}
            height={140}
            loading="eager"
            className={styles.qr}
            style={{ flexShrink: 0 }}
          />
        </div>

        {/* Handover details: who and where, side by side. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
            gap: 12,
            breakInside: "avoid",
          }}
        >
          <section
            style={{
              border: "1px solid #d9d9d9",
              borderRadius: 8,
              padding: "10px 14px",
            }}
          >
            <p className={styles.muted} style={{ margin: 0 }}>
              FROM
            </p>
            <dl className={styles.facts} style={{ marginTop: 6 }}>
              <dt>Person</dt>
              <dd>
                <strong>{summary.fromName || "—"}</strong>
              </dd>

              <dt>Email ID</dt>
              <dd style={{ overflowWrap: "anywhere" }}>{fromEmail || "—"}</dd>

              <dt>Location</dt>
              <dd>{fromLocation}</dd>
            </dl>
          </section>

          <section
            style={{
              border: "1px solid #d9d9d9",
              borderRadius: 8,
              padding: "10px 14px",
            }}
          >
            <p className={styles.muted} style={{ margin: 0 }}>
              TO
            </p>
            <dl className={styles.facts} style={{ marginTop: 6 }}>
              <dt>Person</dt>
              <dd>
                <strong>{summary.toName || "—"}</strong>
              </dd>

              <dt>Email ID</dt>
              <dd style={{ overflowWrap: "anywhere" }}>{toEmail || "—"}</dd>

              <dt>Location</dt>
              <dd>{toLocation}</dd>
            </dl>
          </section>
        </div>

        {/* Other batch details. */}
        <dl className={styles.facts}>
          <dt>Date &amp; time</dt>
          <dd>{formatIst(summary.occurredAt)} IST</dd>

          <dt>Items</dt>
          <dd>
            {itemCountLabel}
            {storageBreakdown && ` (${storageBreakdown})`}
          </dd>

          {summary.note && (
            <>
              <dt>Note</dt>
              <dd style={{ overflowWrap: "anywhere" }}>{summary.note}</dd>
            </>
          )}
        </dl>

        <h2>{ret ? `${itemCountLabel} returned` : itemCountLabel}</h2>

        {/* Item list. The header row repeats on each printed page.
            There is no table footer, so the total prints only once, at the end. */}
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Serial</th>
              <th scope="col">Prism no.</th>
              <th scope="col">Brand / Model</th>
              <th scope="col">Storage</th>
              <th scope="col">Colour</th>
              <th scope="col">Penalty</th>
            </tr>
          </thead>

          <tbody>
            {summary.items.map((item, index) => (
              <tr key={item.itemId} style={{ breakInside: "avoid" }}>
                <td>{index + 1}</td>
                <td style={{ overflowWrap: "anywhere" }}>{item.itemId}</td>
                <td style={{ overflowWrap: "anywhere" }}>
                  {item.prismNo || "—"}
                </td>
                <td>{item.model || item.brand || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{item.storage || "—"}</td>
                <td>{item.cardType || "—"}</td>

                {/* Read the amount saved in items.price.
                    This page does not change or charge it.
                    On a return receipt, items that came back have no penalty. */}
                <td style={{ whiteSpace: "nowrap" }}>
                  {ret
                    ? formatPrice("0")
                    : formatPrice(item.price) || "Not set"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* RETURN RECEIPT: items that were sent but not received, then the summary. */}
        {ret && missingCount > 0 && (
          <>
            <h2 style={{ marginTop: 20 }}>Not returned ({missingCount})</h2>

            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Serial</th>
                  <th scope="col">Prism no.</th>
                  <th scope="col">Brand / Model</th>
                  <th scope="col">Storage</th>
                  <th scope="col">Colour</th>
                  <th scope="col">Penalty</th>
                </tr>
              </thead>

              <tbody>
                {ret.missing.map((item: ReceiptItem, index: number) => (
                  <tr key={item.itemId} style={{ breakInside: "avoid" }}>
                    <td>{index + 1}</td>
                    <td style={{ overflowWrap: "anywhere" }}>{item.itemId}</td>
                    <td style={{ overflowWrap: "anywhere" }}>
                      {item.prismNo || "—"}
                    </td>
                    <td>{item.model || item.brand || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {item.storage || "—"}
                    </td>
                    <td>{item.cardType || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {formatPrice(item.price) || "Not set"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {ret && (
          <section
            style={{
              display: "grid",
              gap: 6,
              marginLeft: "auto",
              marginTop: 12,
              width: "min(100%, 360px)",
              padding: "12px 14px",
              border: "1px solid #d9d9d9",
              borderRadius: 8,
              breakInside: "avoid",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span className={styles.muted}>Items sent</span>
              <span>{ret.sentCount}</span>
            </div>

            {ret.earlierReturnedCount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span className={styles.muted}>Returned earlier</span>
                <span>{ret.earlierReturnedCount}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span className={styles.muted}>Returned now</span>
              <span>{ret.returnedCount}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span className={styles.muted}>Not returned</span>
              <span>{missingCount}</span>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                paddingTop: 8,
                marginTop: 2,
                borderTop: "1px solid #d9d9d9",
                fontSize: "1.05rem",
              }}
            >
              <strong>{returnTotalLabel}</strong>
              <strong style={{ whiteSpace: "nowrap" }}>
                {formatPrice(String(ret.totalPenalty))}
              </strong>
            </div>
          </section>
        )}

        {ret && ret.missingWithoutPrice > 0 && (
          <p className={styles.muted}>
            {ret.missingWithoutPrice} item
            {ret.missingWithoutPrice === 1 ? " has" : "s have"} no valid
            stored amount. Missing amounts are excluded from the total and
            must be verified.
          </p>
        )}

        {/* SEND RECEIPT: summary and total, always after the last item. */}
        {!ret && (
          <>
            <section
              style={{
                display: "grid",
                gap: 6,
                marginLeft: "auto",
                width: "min(100%, 360px)",
                padding: "12px 14px",
                border: "1px solid #d9d9d9",
                borderRadius: 8,
                breakInside: "avoid",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span className={styles.muted}>Total items</span>
                <span>{summary.items.length}</span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  paddingTop: 8,
                  marginTop: 2,
                  borderTop: "1px solid #d9d9d9",
                  fontSize: "1.05rem",
                }}
              >
                <strong>{totalLabel}</strong>
                <strong style={{ whiteSpace: "nowrap" }}>{totalValue}</strong>
              </div>
            </section>

            {missingPriceCount > 0 && (
              <p className={styles.muted}>
                {missingPriceCount} item
                {missingPriceCount === 1 ? " has" : "s have"} no valid stored
                amount. Missing amounts are excluded from the total and must
                be verified.
              </p>
            )}
          </>
        )}

        {/* Use only if this reflects approved company policy.
            The receipt itself does not authorize a deduction.
            On a return receipt it only shows when something is still out. */}
        {(!ret || missingCount > 0) && (
          <p
            style={{
              marginTop: 8,
              padding: "12px 14px",
              border: "1px solid #b91c1c",
              borderLeft: "4px solid #b91c1c",
              borderRadius: 6,
              backgroundColor: "#fff7f7",
              color: "#991b1b",
              fontSize: 14,
              lineHeight: 1.6,
              fontWeight: 600,
              breakInside: "avoid",
            }}
          >
            <strong>IMPORTANT — ITEM RESPONSIBILITY:</strong> You are
            responsible for the safekeeping and timely return of the items
            listed on this receipt. Any loss or damage must be reported
            immediately. If you are found responsible following review, the
            applicable penalty may be deducted from your salary, subject to
            company policy, any required consent, and applicable law. The
            listed amounts are not an automatic charge.
          </p>
        )}
      </div>

      {/* Keep the existing print button outside printable content. */}
      <div className={styles.noPrint}>
        <PrintButton />
      </div>
    </main>
  );
}