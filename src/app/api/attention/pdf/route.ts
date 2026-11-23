import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { storeForAll } from "@/lib/access";
import { buildAttentionReport } from "@/lib/attention";
import { buildAttentionPdf } from "@/lib/attention-pdf";

export const dynamic = "force-dynamic";

// Same login restriction as the /attention page itself — Admin and IM only.
export async function GET() {
  const user = await requireRole("admin", "im");

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
      // "attachment", not "inline": some browsers (notably managed/work Chrome profiles with the
      // built-in PDF viewer disabled by policy) fail with "Couldn't load the PDF library" when a site
      // tries to render a PDF inline. "attachment" tells the browser to save the file straight away
      // instead of trying to preview it, which sidesteps that broken-viewer case entirely.
      "Content-Disposition": `attachment; filename="need-attention-${now.toISOString().slice(0, 10)}.pdf"`,
    },
  });
}