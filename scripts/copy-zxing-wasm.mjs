// Copies the barcode scanner engine (zxing_reader.wasm) into public/zxing/ before every build, so
// phones load it from this site instead of an outside CDN. Runs automatically as "prebuild".
// If it cannot be found, the build still works and the camera scanner uses the library's CDN.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const candidates = [
  "node_modules/zxing-wasm/dist/reader",
  "node_modules/barcode-detector/node_modules/zxing-wasm/dist/reader",
];
const dir = candidates.map((d) => join(process.cwd(), d)).find((d) => existsSync(d));
if (!dir) {
  console.warn("copy-zxing-wasm: zxing-wasm not found; the camera scanner will load it from the CDN.");
} else {
  const out = join(process.cwd(), "public", "zxing");
  mkdirSync(out, { recursive: true });
  const files = readdirSync(dir).filter((f) => f.endsWith(".wasm"));
  for (const f of files) copyFileSync(join(dir, f), join(out, f));
  console.log(`copy-zxing-wasm: copied ${files.join(", ") || "nothing"} to public/zxing/`);
}
