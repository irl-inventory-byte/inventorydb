/** Shown while any page is loading (first open, reload, or moving between pages). */
export default function Loading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="page-loading-spinner" aria-hidden="true" />
      <span>Loading…</span>
    </div>
  );
}