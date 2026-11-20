import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { VIEW_ROLES, storeForAll } from "@/lib/access";
import { buildAttentionReport } from "@/lib/attention";
import { buildAttentionPdf } from "@/lib/attention-pdf";

export const dynamic = "force-dynamic";

// Same login restriction as the /attention page itself (every VIEW_ROLES role except Internal).
export async function GET() {
  const user = await requireRole(...VIEW_ROLES.filter((r) => r !== "internal"));

  const store = storeForAll(user.role);
  const [items, events, people, hubs] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("people"),
    store.list("hubs"),
  ]);

  const now = new Date();
  const { shownDelayed, byType } = buildAttentionReport(items, events, people, hubs, now);
  const pdf = await buildAttentionPdf(shownDelayed, now, byType);

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="need-attention-${now.toISOString().slice(0, 10)}.pdf"`,
    },
  });
}