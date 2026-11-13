"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteInventoryItem } from "./[id]/delete/actions";

/**
 * Inline "Delete" popup for a single item row — same confirmation rules as the full
 * /inventory/<id>/delete page (type the exact id, tick the acknowledgement, a final browser
 * confirm), but as a small modal over the inventory list instead of navigating to a separate page.
 * Submits through the same deleteInventoryItem server action, so the audit log / revalidation /
 * redirect-back-to-/inventory behavior is identical either way.
 */
function PopupFields({ itemId, label, onCancel }: { itemId: string; label: string; onCancel: () => void }) {
  const { pending } = useFormStatus();
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const canDelete = !pending && confirmation === itemId && acknowledged;

  return (
    <>
      <input type="hidden" name="itemId" value={itemId} />

      <p style={{ margin: 0, fontWeight: 700 }}>Delete {label}</p>
      <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
        This permanently removes the item and its event history. Historical receipts and reports may change.
        This cannot be undone from the app.
      </p>

      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        <span>
          Type <strong>{itemId}</strong> to confirm:
        </span>
        <input
          name="confirmation"
          type="text"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          readOnly={pending}
          autoComplete="off"
          spellCheck={false}
          required
          placeholder="Enter the exact serial"
          style={{ padding: 10, border: "1px solid #94a3b8", borderRadius: 6, width: "100%", boxSizing: "border-box" }}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        <span>Reason for deleting (saved in the deletions log):</span>
        <input
          name="reason"
          type="text"
          maxLength={500}
          readOnly={pending}
          placeholder="e.g. Added twice by mistake"
          style={{ padding: 10, border: "1px solid #94a3b8", borderRadius: 6, width: "100%", boxSizing: "border-box" }}
        />
      </label>

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
        <input
          type="checkbox"
          name="deleteHistory"
          value="yes"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          disabled={pending}
          required
        />
        <span>I understand this permanently removes the item and its event history.</span>
      </label>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="submit"
          disabled={!canDelete}
          style={{
            padding: "9px 14px",
            border: 0,
            borderRadius: 6,
            backgroundColor: "#b91c1c",
            color: "#fff",
            fontWeight: 700,
            cursor: !canDelete ? "not-allowed" : "pointer",
            opacity: !canDelete ? 0.6 : 1,
          }}
        >
          {pending ? "Deleting…" : "Permanently delete"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          style={{ padding: "9px 14px", borderRadius: 6, border: "1px solid #94a3b8", background: "transparent", color: "inherit", cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </>
  );
}

export default function DeleteItemPopup({
  itemId,
  brand,
  model,
}: {
  itemId: string;
  brand?: string;
  model?: string;
}) {
  const [open, setOpen] = useState(false);
  const label = [brand, model].filter(Boolean).join(" ") || itemId;

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Delete item ${itemId}`}
        style={{
          display: "inline-block",
          padding: "5px 10px",
          border: "1px solid #b91c1c",
          borderRadius: 6,
          color: "#b91c1c",
          backgroundColor: "#fff7f7",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Delete
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <form
            action={deleteInventoryItem}
            onSubmit={(event) => {
              const formData = new FormData(event.currentTarget);
              const confirmation = String(formData.get("confirmation") ?? "");
              const acknowledged = formData.get("deleteHistory") === "yes";
              if (confirmation !== itemId || !acknowledged) {
                event.preventDefault();
                return;
              }
              const confirmed = window.confirm(
                `Are you sure you want to permanently delete "${itemId}"?\n\n` +
                  "This will also delete its associated event history and affect historical receipts and activity reports.\n\n" +
                  "This cannot be undone from the app.\n\n" +
                  "Click OK to delete, or Cancel to keep the item."
              );
              if (!confirmed) event.preventDefault();
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              background: "#1e293b",
              color: "#e2e8f0",
              borderRadius: 10,
              padding: 20,
              width: "100%",
              maxWidth: 420,
              boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
            }}
          >
            <PopupFields itemId={itemId} label={label} onCancel={() => setOpen(false)} />
          </form>
        </div>
      )}
    </>
  );
}