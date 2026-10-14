import { parseTable } from "./csv";
import { normalizeMobile } from "./mobile";
import type { Hub, Person, Role } from "./schema";

export interface PeopleImportPlan {
  adds: Person[];
  skipped: string[];
  errors: string[];
}

const ROLE_ALIASES: Record<string, Role> = {
  im: "im",
  "inventory manager": "im",
  ifo: "ifo",
  fo: "fo",
  "field officer": "fo",
  rig: "rig",
  "rig team": "rig",
  hardware: "hardware",
  "hardware team": "hardware",
  qc: "qc",
  "qc team": "qc",
  internal: "internal",
};

// "Bangalore - IRL" and "Bangalore" both match the hub named "Bangalore".
const normalizeHub = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s*[-–—]\s*irl$/i, "")
    .replace(/\s+/g, " ")
    .trim();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks pasted people data against hubs and existing people. Pure, so it can be previewed safely. */
export function planPeopleImport(
  text: string,
  hubs: Hub[],
  existing: Person[],
  newId: () => string,
): PeopleImportPlan {
  const plan: PeopleImportPlan = { adds: [], skipped: [], errors: [] };
  const table = parseTable(text);
  if (table.length < 2) {
    plan.errors.push("Add a header row (Name, Role, Hub, Email, Mobile) and at least one person.");
    return plan;
  }

  const header = table[0].map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [iName, iRole, iHub, iEmail] = ["name", "role", "hub", "email"].map(col);
  // "Mobile", "Mobile number", "Phone" or "Phone number".
  const iMobile = header.findIndex((h) => ["mobile", "mobile number", "mobile no", "phone", "phone number"].includes(h.trim()));
  const missing = ["name", "role", "hub"].filter((n) => col(n) === -1);
  if (iMobile === -1) missing.push("mobile");
  if (missing.length) {
    plan.errors.push(`Missing column(s): ${missing.join(", ")}. Expected: Name, Role, Hub, Email, Mobile.`);
    return plan;
  }
  const seenMobiles = new Set(existing.map((p) => p.mobile ?? "").filter(Boolean));

  const hubByKey = new Map<string, Hub>();
  for (const h of hubs) {
    hubByKey.set(normalizeHub(h.name), h);
    hubByKey.set(h.hub_id, h);
  }
  const seen = new Set(existing.map((p) => `${p.name.toLowerCase()}|${p.hub}`));

  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const name = cells[iName] ?? "";
    const roleText = (cells[iRole] ?? "").toLowerCase();
    const hubText = cells[iHub] ?? "";
    const email = (iEmail === -1 ? "" : (cells[iEmail] ?? "")).toLowerCase();

    const problems: string[] = [];
    if (!name) problems.push("name is empty");
    const role = ROLE_ALIASES[roleText];
    if (!role) problems.push(`role "${cells[iRole] ?? ""}" is not IM, IFO, FO, Rig, Hardware or QC`);
    const hub = hubByKey.get(normalizeHub(hubText));
    if (!hub) problems.push(`hub "${hubText}" not found`);
    else if (hub.active === "false") problems.push(`hub "${hub.name}" is inactive`);
    if (email && !EMAIL.test(email)) problems.push(`email "${email}" is not valid`);
    const mobileText = cells[iMobile] ?? "";
    const mobile = normalizeMobile(mobileText);
    if (!mobile) problems.push(mobileText ? `mobile "${mobileText}" is not a valid 10-digit number` : "mobile is empty");
    if (problems.length) {
      plan.errors.push(`Row ${line}: ${problems.join("; ")}`);
      return;
    }

    const key = `${name.toLowerCase()}|${hub!.hub_id}`;
    if (seen.has(key)) {
      plan.skipped.push(`Row ${line}: ${name} (${hub!.name}) already exists`);
      return;
    }
    if (seenMobiles.has(mobile)) {
      plan.errors.push(`Row ${line}: mobile ${mobile} is already used by another person`);
      return;
    }
    seen.add(key);
    seenMobiles.add(mobile);
    plan.adds.push({
      person_id: newId(),
      name,
      role: role!,
      hub: hub!.hub_id,
      linked_user: email,
      active: "true",
      mobile,
    });
  });
  return plan;
}