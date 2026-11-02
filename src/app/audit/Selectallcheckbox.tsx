"use client";

/** Ticks or clears every "ids" checkbox inside the given form when this one is toggled. */
export default function SelectAllCheckbox({ formId }: { formId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all items to audit"
      onChange={(e) => {
        const form = document.getElementById(formId);
        form?.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((cb) => {
          cb.checked = e.target.checked;
        });
      }}
    />
  );
}