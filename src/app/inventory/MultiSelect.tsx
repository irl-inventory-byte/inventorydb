/**
 * A dropdown of checkboxes for a GET filter form: tick several options and
 * press Filter. Works without JavaScript (a native <details> element), and
 * each ticked box is sent as its own value, e.g. ?status=in_stock&status=with_fo.
 */
export default function MultiSelect({
  name,
  label,
  allLabel,
  options,
  selected,
}: {
  name: string;
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
  selected: string[];
}) {
  const chosen = options.filter((o) => selected.includes(o.value));
  const summary =
    chosen.length === 0
      ? allLabel
      : chosen.length <= 2
        ? chosen.map((o) => o.label).join(", ")
        : `${chosen.length} selected`;

  return (
    <details style={{ position: "relative" }}>
      <summary
        aria-label={`${label}: ${summary}`}
        style={{
          listStyle: "none",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minHeight: 36,
          padding: "6px 12px",
          border: "1px solid #b5b5b5",
          borderRadius: 6,
          background: chosen.length ? "#EEF2FF" : "#fff",
          color: "#1a1a1a",
          whiteSpace: "nowrap",
          maxWidth: 260,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <strong style={{ fontWeight: 600 }}>{label}:</strong> {summary}
        <span aria-hidden="true" style={{ fontSize: 10, marginLeft: 2 }}>
          ▼
        </span>
      </summary>

      <div
        role="group"
        aria-label={label}
        style={{
          position: "absolute",
          zIndex: 20,
          top: "calc(100% + 4px)",
          left: 0,
          minWidth: 220,
          maxHeight: 320,
          overflowY: "auto",
          padding: 8,
          background: "#fff",
          color: "#1a1a1a",
          border: "1px solid #b5b5b5",
          borderRadius: 8,
          boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {options.map((o) => (
          <label
            key={o.value}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 32,
              padding: "4px 6px",
              borderRadius: 4,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={selected.includes(o.value)}
            />
            {o.label}
          </label>
        ))}
        {options.length === 0 && <span style={{ padding: 6, color: "#666" }}>Nothing to choose</span>}
      </div>
    </details>
  );
}