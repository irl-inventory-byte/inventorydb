"use client";

import { useRef, useState } from "react";

/**
 * Inventory search for one or many items. Type or scan codes one per line (a scanner's Enter starts a new
 * line), or separate them with commas. Serial, IMEI, Asset Tag, rig ID, prism no., brand or model.
 * Press Filter (or Ctrl + Enter) to search all of them at once.
 */
export default function SearchBox({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLTextAreaElement>(null);
  const count = value
    .split(/[,;\n]+/)
    .map((v) => v.trim())
    .filter(Boolean).length;
  const rows = Math.min(6, Math.max(1, value.split("\n").length));

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, flex: "1 1 260px", minWidth: 220, maxWidth: 420 }}>
      <textarea
        ref={ref}
        name="q"
        value={value}
        rows={rows}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl / Cmd + Enter searches; a plain Enter (or a scanner) starts the next line.
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            ref.current?.form?.requestSubmit();
          }
        }}
        placeholder={"Search one or many items: one per line (scan one after another) or separated by commas.\nSerial, IMEI, Asset Tag, rig ID, prism no., brand"}
        aria-label="Search inventory (one or many items)"
        style={{
          width: "100%",
          padding: "7px 10px",
          border: "1px solid #c9c9c9",
          borderRadius: 6,
          font: "inherit",
          resize: "vertical",
          lineHeight: 1.35,
          boxSizing: "border-box",
        }}
      />
      {count > 1 && (
        <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
          {count} items to search · press Filter (or Ctrl + Enter)
        </span>
      )}
    </span>
  );
}