import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/authz";
import { STATUS_LABELS, one } from "@/lib/labels";
import { getStore } from "@/lib/store";
import DeleteConfirmationForm from "./DeleteConfirmationForm";

export default async function DeleteItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string | string[];
  }>;
}) {
  // Only Admin can access this page.
  await requireRole("admin");

  const { id } = await params;
  const sp = await searchParams;

  const store = getStore();
  // getItemFresh, not getItem: a stale per-instance cache must never make a just-added item look like
  // it doesn't exist (see lib/store/store.ts and backend.ts for why).
  const item = await store.getItemFresh(id);

  if (!item) {
    notFound();
  }

  const history = await store.getHistory(item.item_id);

  return (
    <main
      style={{
        maxWidth: 680,
        margin: "0 auto",
        padding: 24,
      }}
    >
      <p>
        <Link href="/inventory">
          ← Inventory
        </Link>
      </p>

      <h1>Delete inventory item</h1>

      <p>
        This operation is available only to administrators.
      </p>

      {one(sp.error) && (
        <p
          role="alert"
          style={{
            color: "#991b1b",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            padding: 12,
            borderRadius: 8,
          }}
        >
          {one(sp.error)}
        </p>
      )}

      <section
        aria-label="Confirm inventory deletion"
        style={{
          border: "1px solid #dc2626",
          borderRadius: 12,
          padding: 20,
          marginTop: 20,
        }}
      >
        <h2 style={{ overflowWrap: "anywhere" }}>
          {item.item_id}
        </h2>

        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(100px, 1fr) 2fr",
            gap: "10px 16px",
          }}
        >
          <dt>Brand</dt>
          <dd style={{ margin: 0 }}>
            {item.brand || "—"}
          </dd>

          <dt>Model</dt>
          <dd style={{ margin: 0 }}>
            {item.model || "—"}
          </dd>

          <dt>Status</dt>
          <dd style={{ margin: 0 }}>
            {STATUS_LABELS[item.status] ?? item.status}
          </dd>

          <dt>Associated event records</dt>
          <dd style={{ margin: 0 }}>
            {history.length}
          </dd>
        </dl>

        <p
          style={{
            color: "#b91c1c",
            fontWeight: 700,
            marginTop: 20,
          }}
        >
          This permanently deletes the item and its associated
          event history.
        </p>

        <p>
          Historical receipts and activity reports will change.
          A receipt containing only this item may no longer
          exist. This cannot be undone from the app.
        </p>

        <p>
          Back up the inventory spreadsheet and pause other
          inventory writes or manual sheet edits before proceeding.
        </p>

        {/* Client component displays the final confirmation popup. */}
        <DeleteConfirmationForm itemId={item.item_id} />
      </section>
    </main>
  );
}