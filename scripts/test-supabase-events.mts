import assert from "node:assert/strict";
import { SupabaseBackend } from "../src/lib/store/supabase";
import { TABS } from "../src/lib/schema";

// A tiny fake of Supabase's REST API: enough for reads (select, _seq=gt., order, limit, offset, count).
let rows: Record<string, unknown>[] = [];
let seq = 0;
const requests: string[] = [];
const add = (n: number) => {
  for (let i = 0; i < n; i++) {
    seq++;
    const r: Record<string, unknown> = { _seq: seq };
    for (const c of TABS.events) r[c] = `${c}-${seq}`;
    rows.push(r);
  }
};
globalThis.fetch = (async (input: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
  const url = new URL(input);
  const tab = url.pathname.split("/").pop();
  requests.push(`${init?.method ?? "GET"} ${tab}?${url.searchParams.toString()}`);
  if (init?.method === "POST" && tab === "events") {
    for (const r of JSON.parse(init.body ?? "[]") as Record<string, unknown>[]) rows.push({ ...r, _seq: ++seq });
    return new Response(null, { status: 201 });
  }
  if (tab === "table_versions") return new Response(JSON.stringify([]), { status: 200 });
  if (tab !== "events") return new Response("[]", { status: 200 });
  const gt = url.searchParams.get("_seq");
  let list = rows.slice().sort((a, b) => Number(a._seq) - Number(b._seq));
  if (gt) list = list.filter((r) => Number(r._seq) > Number(gt.replace("gt.", "")));
  const total = list.length;
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 1000);
  const page = list.slice(offset, offset + limit);
  const headers = new Headers();
  if (init?.headers?.Prefer === "count=exact") headers.set("content-range", `${offset}-${offset + page.length - 1}/${total}`);
  return new Response(JSON.stringify(page), { status: 200, headers });
}) as typeof fetch;

const b = new SupabaseBackend({ url: "https://x.supabase.co", key: "sb_secret_x" });

add(2500);
let got = await b.readAll("events");
assert.equal(got.length, 2500);
assert.equal(got[0].event_id, "event_id-1");
assert.equal(got[2499].event_id, "event_id-2500");
assert.ok(!("_seq" in got[0]), "_seq is not passed on");

// New rows: only those are fetched (plus one count request)
add(3);
requests.length = 0;
got = await b.readAll("events");
assert.equal(got.length, 2503);
assert.equal(got[2502].event_id, "event_id-2503");
assert.ok(requests.some((r) => r.includes("_seq=gt.2500")), "asked only for rows after 2500");
assert.ok(!requests.some((r) => r.includes("offset=1000")), "did not download everything again");

// Nothing new: still correct, still small
requests.length = 0;
got = await b.readAll("events");
assert.equal(got.length, 2503);
assert.ok(requests.length <= 2);

// A row deleted elsewhere: the count does not match, so everything is downloaded again
rows = rows.filter((r) => r._seq !== 10);
add(1);
got = await b.readAll("events");
assert.equal(got.length, 2503);
assert.ok(!got.some((r) => r.event_id === "event_id-10"));
assert.equal(got[got.length - 1].event_id, "event_id-2504");

// Callers get copies: changing one does not change the kept rows
got[0].note = "changed";
assert.notEqual((await b.readAll("events"))[0].note, "changed");

// Reads at the same moment share one refresh
add(1);
requests.length = 0;
const [x, y] = await Promise.all([b.readAll("events"), b.readAll("events")]);
assert.equal(x.length, 2504);
assert.equal(y.length, 2504);
assert.equal(requests.filter((r) => r.includes("_seq=gt.")).length, 1);

// A send or receive (rows added through this server) does not download the whole history again
const newRow: Record<string, string> = {};
for (const c of TABS.events) newRow[c] = "sent-now";
requests.length = 0;
await b.append("events", [newRow]);
got = await b.readAll("events");
assert.equal(got.length, 2505);
assert.equal(got[got.length - 1].event_id, "sent-now");
assert.ok(!requests.some((r) => r.startsWith("GET events") && !r.includes("_seq=gt.") && !r.includes("select=_seq&limit=1")), "no full download after an add");

console.log("supabase events: all checks passed");
