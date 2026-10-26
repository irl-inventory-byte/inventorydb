import type { CSSProperties } from "react";
import { MOBILE_IMAGE, RIG_IMAGE, SD_256_IMAGE, SD_512_IMAGE, SD_CARD_IMAGE } from "./item-images";

/**
 * SD card / Rig / Mobile tags. Blue for SD cards, orange for rigs, green for mobiles, each with its own
 * icon so they can be told apart without colour (and when printed in grey).
 * No hooks, so it works on server pages and inside client components.
 */

type Kind = "sd_card" | "rig" | "mobile";
const KINDS: Kind[] = ["sd_card", "rig", "mobile"];

const kindOf = (type: string | undefined): Kind => (type === "rig" ? "rig" : type === "mobile" ? "mobile" : "sd_card");

const LOOK: Record<Kind, { label: string; plural: string; bg: string; fg: string; border: string }> = {
  sd_card: { label: "SD card", plural: "SD cards", bg: "#E6EEFF", fg: "#1D3FA8", border: "#B9CBF5" },
  rig: { label: "Rig", plural: "Rigs", bg: "#FFF1DC", fg: "#8A4300", border: "#F2C98F" },
  mobile: { label: "Mobile", plural: "Mobiles", bg: "#E3F5EA", fg: "#14653A", border: "#A8DDBC" },
};

/** Light row tint so rigs stand out in long tables. */
export const RIG_ROW_BG = "#FFFBF4";
export const rowTint = (type: string | undefined): CSSProperties | undefined =>
  kindOf(type) === "rig" ? { backgroundColor: RIG_ROW_BG } : undefined;

// Each item type shows a small photo. An SD card shows its own card: 256 GB or 512 GB (both when not set).
const PHOTO: Record<Kind, string> = { sd_card: SD_CARD_IMAGE, mobile: MOBILE_IMAGE, rig: RIG_IMAGE };

/** "256 GB" / "512 GB" from a saved storage value, or "" when it is not set. */
function sizeOf(storage?: string): string {
  const gb = String(storage ?? "").replace(/\s+/g, "").toUpperCase();
  return gb === "256GB" || gb === "256" ? "256 GB" : gb === "512GB" || gb === "512" ? "512 GB" : "";
}

function photoFor(kind: Kind, storage?: string): string {
  if (kind === "sd_card") {
    const gb = String(storage ?? "").replace(/\s+/g, "").toUpperCase();
    if (gb === "256GB" || gb === "256") return SD_256_IMAGE;
    if (gb === "512GB" || gb === "512") return SD_512_IMAGE;
  }
  return PHOTO[kind];
}

function Icon({ kind, size, storage }: { kind: Kind; size: number; storage?: string }) {
  const photo = photoFor(kind, storage);
  if (photo) {
    const h = Math.round(size * 2.2); // photos a bit bigger than the icon, so the item can be recognised
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photo} alt="" aria-hidden="true" height={h} style={{ height: h, width: "auto", flexShrink: 0, display: "block" }} />
    );
  }
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {kind === "rig" ? (
        <>
          <path d="M3 8h4l2-3h6l2 3h4v11H3z" />
          <circle cx="12" cy="13" r="3.5" />
        </>
      ) : kind === "mobile" ? (
        <>
          <rect x="6" y="2" width="12" height="20" rx="2" />
          <path d="M11 18h2" />
        </>
      ) : (
        <>
          <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
          <path d="M9 6v3M12 6v3M15 6v3" />
        </>
      )}
    </svg>
  );
}

const pill = (kind: Kind, big: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: big ? 6 : 5,
  padding: big ? "4px 12px" : "2px 9px",
  borderRadius: 999,
  background: LOOK[kind].bg,
  color: LOOK[kind].fg,
  border: `1px solid ${LOOK[kind].border}`,
  fontSize: big ? 14 : 12.5,
  fontWeight: 600,
  lineHeight: 1.5,
  whiteSpace: "nowrap",
  printColorAdjust: "exact",
  WebkitPrintColorAdjust: "exact",
});

/** One tag: "SD card", "Rig" or "Mobile", with its photo. `storage` picks the 256 GB / 512 GB card photo. */
export function TypeBadge({ type, storage }: { type: string | undefined; storage?: string }) {
  const kind = kindOf(type);
  return (
    <span style={pill(kind, false)}>
      <Icon kind={kind} size={12} storage={storage} />
      {kind === "sd_card" && sizeOf(storage) ? `SD card · ${sizeOf(storage)}` : LOOK[kind].label}
    </span>
  );
}

/** Counts, e.g. "3 SD cards · 2 Rigs". Shows only the types present. */
export function TypeCounts({ types }: { types: (string | undefined)[] }) {
  const counts: Record<Kind, number> = { sd_card: 0, rig: 0, mobile: 0 };
  for (const t of types) counts[kindOf(t)]++;

  const shown = KINDS.filter((k) => counts[k] > 0);
  if (shown.length === 0) return null;

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {shown.map((k) => (
        <span key={k} style={pill(k, true)}>
          <Icon kind={k} size={14} />
          {counts[k]} {counts[k] === 1 ? LOOK[k].label : LOOK[k].plural}
        </span>
      ))}
    </span>
  );
}

/** Plain-text counts for buttons and messages: "3 SD cards, 2 Rigs". */
export function typeCountText(types: (string | undefined)[]): string {
  const counts: Record<Kind, number> = { sd_card: 0, rig: 0, mobile: 0 };
  for (const t of types) counts[kindOf(t)]++;
  return KINDS
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${counts[k] === 1 ? LOOK[k].label : LOOK[k].plural}`)
    .join(", ");
}