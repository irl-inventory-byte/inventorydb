"use client";

/**
 * The From / To date inputs for the day/hourly "moved" charts' filter bar (see daily-moves.tsx's
 * MoveFilters). Split into its own small client component — daily-moves.tsx itself is a server
 * component — only so the date pickers can carry an onChange: picking a new date clears any ticked
 * "Items" checkboxes in the same form, so applying a new date range falls back to "All items" instead
 * of silently keeping whatever item type was chosen before.
 */
export default function DateRangeInputs({
  prefix,
  from,
  to,
  today,
}: {
  prefix: "m" | "h"; // m… = day chart, h… = hourly chart — matches the ?mtype=/?htype= checkbox names
  from: string;
  to: string;
  today: string;
}) {
  const resetItemType = (e: React.ChangeEvent<HTMLInputElement>) => {
    const form = e.currentTarget.form;
    form?.querySelectorAll<HTMLInputElement>(`input[name="${prefix}type"]`).forEach((cb) => {
      cb.checked = false;
    });
  };
  return (
    <>
      <label>
        From
        <input type="date" name={`${prefix}from`} defaultValue={from} max={today} onChange={resetItemType} />
      </label>
      <label>
        To
        <input type="date" name={`${prefix}to`} defaultValue={to} max={today} onChange={resetItemType} />
      </label>
    </>
  );
}