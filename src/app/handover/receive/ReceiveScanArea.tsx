"use client";

import type { Status } from "@/lib/schema";
import ScanBox from "../ScanBox";

/**
 * Receive's scan area: the item scan box. Every item is scanned (scanner gun or phone camera) one by one;
 * receiving a whole batch from its receipt QR code is switched off, so each returned item is checked.
 */
export default function ReceiveScanArea({
  hub,
  hubNames,
  items,
  allowed,
}: {
  hub: string;
  hubNames: Record<string, string>;
  items: { id: string; status: Status; hub: string; type?: string; aliases?: string[] }[];
  allowed?: readonly string[]; // QC / hardware team: only rigs sent to them
}) {
  return <ScanBox id="scanned" mode="receive" hub={hub} hubNames={hubNames} items={items} allowed={allowed} />;
}
