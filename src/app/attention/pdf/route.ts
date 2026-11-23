import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/authz";
import { storeForAll } from "@/lib/access";
import { buildAttentionReport, filterDelayed, type AttentionFilters } from "@/lib/attention";
import { buildAttentionPdf } from "@/lib/attention-pdf";

export const dynamic = "force-dynamic";

// Same login restriction as the /attention page itself — Admin and IM only.
export async function GET(request: NextRequest) {
  const user = await requireRole("admin", "im");

  const sp = request.nextUrl.searchParams;
  const minDaysRaw = Number(sp.get("days") || "0");
  const filters: AttentionFilters = {
    minDays: Number.isFinite(minDaysRaw) && minDaysRaw > 0 ? minDaysRaw : 0,
    type: sp.get("type") ?? "",
    role: sp.get("role") ?? "",
    city: sp.get("city") ?? "",
  };

  const store = storeForAll(user.role);
  const [items, events, people, hubs] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("people"),
    store.list("hubs"),
  ]);

  const now = new Date();
  const { shownDelayed: allDelayed } = buildAttentionReport(items, events, people, hubs, now);
  const shownDelayed = filterDelayed(allDelayed, filters);

  // byType reflects the same filtered rows, so the PDF's summary line matches what's actually in it.
  const byType = new Map<string, number>();
  for (const g of shownDelayed) byType.set(g.type, (byType.get(g.type) ?? 0) + g.count);

  const pdf = await buildAttentionPdf(shownDelayed, now, byType);

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // "attachment", not "inline" — Chrome's built-in PDF viewer fails to open this inline on some
      // managed/work profiles ("Couldn't load the PDF library"). Downloading it instead sidesteps
      // that viewer entirely.
      "Content-Disposition": `attachment; filename="need-attention-${now.toISOString().slice(0, 10)}.pdf"`,
    },
  });
}