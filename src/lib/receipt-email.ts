import nodemailer from "nodemailer";
import type { BatchSummary } from "./receipt";
import { getStore } from "./store";
import { formatIst } from "./time";
import { acknowledgmentText } from "./acknowledgment-text";

/**
 * Emails the receipt PDF to both people on a batch: the person who sent the
 * items (From) and the person who received them (To).
 *
 * Email addresses are looked up by name in the people tab of the store.
 * The lookup is forgiving:
 *   - Tab: PEOPLE_TAB if set, otherwise the first of "person", "people",
 *     "persons", "users", "employees", "staff", "team" that has data.
 *   - Email column: any column whose header contains "mail"
 *     (email, Email ID, Mail ID, Email Address, e-mail ...). If there is no
 *     such column, any cell in the row that looks like an email is used.
 *   - Name column: name, full name, person, person name, employee name ...
 *     or any column whose header contains "name".
 *   - Names are matched ignoring capital letters, extra spaces and dots,
 *     so "Sharath M S", "sharath m.s." and "SHARATH  M S" all match.
 *
 * Settings (Vercel → Project → Settings → Environment Variables):
 *   SMTP_USER     Gmail / Workspace address that sends the email   (required)
 *   SMTP_PASS     App password for that account, no spaces         (required)
 *   SMTP_HOST     default smtp.gmail.com
 *   SMTP_PORT     default 465
 *   MAIL_FROM     e.g. "Instawork Receipts <receipts@yourcompany.com>"
 *                 default: SMTP_USER
 *   PEOPLE_TAB    store tab with names and emails (optional, see above)
 */

const TAB_CANDIDATES = ["person", "people", "persons", "users", "employees", "staff", "team"];
const PREFERRED_NAME_HEADERS = [
  "name",
  "fullname",
  "person",
  "personname",
  "employeename",
  "staffname",
  "membername",
];

type Row = Record<string, unknown>;

/** "Email ID" -> "emailid", "Full Name" -> "fullname" */
const headerKey = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Sharath  M.S." -> "sharath m s" */
const nameKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function emailFromRow(row: Row): string {
  // 1. A column whose header contains "mail".
  for (const [header, value] of Object.entries(row)) {
    if (headerKey(header).includes("mail") && looksLikeEmail(text(value))) {
      return text(value);
    }
  }
  // 2. Any cell that looks like an email.
  for (const value of Object.values(row)) {
    if (looksLikeEmail(text(value))) return text(value);
  }
  return "";
}

function nameFromRow(row: Row): string {
  const entries = Object.entries(row).map(([header, value]) => [headerKey(header), text(value)] as const);

  for (const wanted of PREFERRED_NAME_HEADERS) {
    const match = entries.find(([key, value]) => key === wanted && value);
    if (match) return match[1];
  }

  // Any header containing "name", but not things like hub/location/user names.
  const loose = entries.find(
    ([key, value]) =>
      value &&
      key.includes("name") &&
      !/(hub|location|site|city|user|login|file|brand|model)/.test(key)
  );
  return loose ? loose[1] : "";
}

async function readTab(tab: string): Promise<Row[]> {
  const store = getStore();
  const list = store.list as unknown as (collection: string) => Promise<Row[]>;
  try {
    const rows = await list.call(store, tab);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export type EmailLookup = {
  /** Store tab the emails were read from ("" if none had data). */
  tab: string;
  /** Name as written on the receipt -> email address. */
  emails: Map<string, string>;
};

/**
 * Finds email addresses for the given names.
 * Exported so the on-screen receipt can show the same Email ID.
 */
export async function lookupEmails(names: string[]): Promise<EmailLookup> {
  const tabs = process.env.PEOPLE_TAB ? [process.env.PEOPLE_TAB] : TAB_CANDIDATES;

  let usedTab = "";
  let rows: Row[] = [];
  for (const tab of tabs) {
    rows = await readTab(tab);
    if (rows.length > 0) {
      usedTab = tab;
      break;
    }
  }

  const byName = new Map<string, string>();
  for (const row of rows) {
    const name = nameFromRow(row);
    const email = emailFromRow(row);
    if (name && email) byName.set(nameKey(name), email);
  }

  const emails = new Map<string, string>();
  for (const name of names) {
    const email = name ? byName.get(nameKey(name)) : undefined;
    if (email) emails.set(name, email);
  }

  return { tab: usedTab, emails };
}

/** person_id -> email: the People entry's email, else the login linked to that person on Manage users. */
async function emailsByPersonId(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const store = getStore();
    const [people, users] = await Promise.all([store.list("people"), store.list("users")]);
    for (const u of users) {
      if (u.person_id && looksLikeEmail(u.email) && u.active !== "false") out.set(u.person_id, u.email.trim());
    }
    for (const p of people) {
      if (looksLikeEmail(p.linked_user ?? "")) out.set(p.person_id, p.linked_user.trim());
    }
  } catch {
    // Fall back to the lookup by name.
  }
  return out;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function transport() {
  const user = process.env.SMTP_USER;
  const pass = (process.env.SMTP_PASS ?? "").replace(/\s+/g, "");
  if (!user || !pass) {
    throw new Error("Receipt email needs SMTP_USER and SMTP_PASS in Vercel settings.");
  }

  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export type ReceiptEmailResult = {
  sentTo: string[];
  /** Names on the batch with no email found. */
  missing: string[];
  /** Tab the emails were looked up in. */
  tab: string;
};

/**
 * Sends the receipt PDF to the given recipient(s). Pass `acknowledgment` to add a one-click
 * "Yes, I acknowledge" link for whoever is now personally holding the items — clicking it marks it
 * acknowledged immediately (see app/handover/ack/[token]), no extra confirmation step. Omit it for a
 * copy sent to someone else on the same batch (e.g. whoever handed the items over), who isn't being
 * asked to acknowledge anything.
 * Throws if sending fails; returns who it was sent to and who had no email.
 */
export async function sendReceiptEmail(options: {
  summary: BatchSummary;
  title: string;
  pdf: Uint8Array;
  fileName: string;
  receiptUrl: string;
  totalPenalty: string;
  /** Who to email (person_id + name). Default: just the To person of the receipt. */
  people?: { id: string; name: string }[];
  /** One-click acknowledgment link, shown under the receipt details. Omit to leave it out. */
  acknowledgment?: { yesUrl: string };
}): Promise<ReceiptEmailResult> {
  const { summary, title, pdf, fileName, receiptUrl, totalPenalty, acknowledgment } = options;

  const recipients = (options.people ?? [{ id: summary.toId, name: summary.toName }]).filter(
    (r) => r.id || r.name,
  );
  const names = [...new Set(recipients.map((r) => r.name).filter(Boolean))];
  const { tab, emails } = await lookupEmails(names);
  // First by person: the email on their People entry, or the login linked to them; then by name.
  const byId = await emailsByPersonId();
  const found = new Map<string, string>(); // recipient label -> email
  for (const r of recipients) {
    const email = byId.get(r.id) || (looksLikeEmail(r.id) ? r.id : "") || emails.get(r.name);
    if (email) found.set(r.name || r.id, email);
  }

  const missing = [...new Set(recipients.map((r) => r.name || r.id))].filter((label) => !found.has(label));
  const sentTo = [...new Set([...found.values()].map((e) => e.toLowerCase()))];

  if (!tab) {
    console.warn(
      `[receipt-email] No people tab found. Tried: ${(process.env.PEOPLE_TAB ? [process.env.PEOPLE_TAB] : TAB_CANDIDATES).join(", ")}. Set PEOPLE_TAB in Vercel.`
    );
  }

  if (sentTo.length === 0) {
    console.warn(
      `[receipt-email] Batch ${summary.batchId}: no email found for ${names.join(" / ")} in tab "${tab || "none"}". Nothing sent.`
    );
    return { sentTo, missing, tab };
  }

  const itemCount = summary.items.length;
  const when = `${formatIst(summary.occurredAt)} IST`;
  const sentBy = `${summary.fromName || "—"}${summary.fromHubName ? ` (${summary.fromHubName})` : ""}`;
  const sentToLabel = `${summary.toName || "—"}${summary.hubName ? ` (${summary.hubName})` : ""}`;
  const subject = `${title} ${summary.batchId} - ${summary.fromName || "—"} to ${summary.toName || "—"}`;

  const textBody = [
    `${title} for batch ${summary.batchId}`,
    "",
    `Sent by: ${sentBy}`,
    `Sent to: ${sentToLabel}`,
    `Date & time: ${when}`,
    `Items: ${itemCount}`,
    `Total listed penalty amount: ${totalPenalty}`,
    "",
    `View the receipt online: ${receiptUrl}`,
    "",
    "The PDF receipt is attached.",
    ...(acknowledgment
      ? [
          "",
          acknowledgmentText(summary.fromName),
          "",
          `Yes, I acknowledge: ${acknowledgment.yesUrl}`,
        ]
      : []),
  ].join("\n");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#666">${escapeHtml(label)}</td><td style="padding:4px 0"><strong>${escapeHtml(value)}</strong></td></tr>`;

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a">
  <p style="font-size:18px;margin:0 0 12px"><strong>${escapeHtml(title)}</strong> &middot; Batch ${escapeHtml(summary.batchId)}</p>
  <table style="border-collapse:collapse">
    ${row("Sent by", sentBy)}
    ${row("Sent to", sentToLabel)}
    ${row("Date & time", when)}
    ${row("Items", String(itemCount))}
    ${row("Total listed penalty amount", totalPenalty)}
  </table>
  <p style="margin:16px 0"><a href="${escapeHtml(receiptUrl)}">View the receipt online</a></p>
  <p style="color:#666;margin:0 0 16px">The PDF receipt is attached.</p>
  ${
    acknowledgment
      ? `
  <div style="margin:20px 0;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
    <p style="margin:0 0 14px">${escapeHtml(acknowledgmentText(summary.fromName))}</p>
    <a href="${escapeHtml(acknowledgment.yesUrl)}" style="display:inline-block;padding:10px 18px;background:#15803D;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Yes, I acknowledge</a>
  </div>`
      : ""
  }
</div>`;

  await transport().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: sentTo,
    subject,
    text: textBody,
    html,
    attachments: [
      {
        filename: fileName,
        content: Buffer.from(pdf),
        contentType: "application/pdf",
      },
    ],
  });

  console.log(`[receipt-email] Batch ${summary.batchId}: sent to ${sentTo.join(", ")}.`);
  return { sentTo, missing, tab };
}
