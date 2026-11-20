"use client";

/** Admin-only: pick which QC person's QC-failed rigs to show, by re-navigating this page (GET) — same
 * instant-filter pattern as FromFoPicker on the Transfer between FOs page. */
export default function QcPersonPicker({
  qcPeople,
  defaultId,
}: {
  qcPeople: { id: string; name: string }[];
  defaultId: string;
}) {
  return (
    <form method="GET" action="/qc/handover" style={{ display: "inline-block" }}>
      <select
        name="person"
        defaultValue={defaultId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        disabled={qcPeople.length === 0}
      >
        {qcPeople.length === 0 && <option value="">No active QC person</option>}
        {qcPeople.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </form>
  );
}