// How far the document store has got: counts only, no document text and nothing anyone typed.
import { NextResponse } from "next/server";
import { ingestState } from "@/lib/doc-ingest";
import { docStoreStatus } from "@/lib/doc-store";
import { priceSheetSummary } from "@/lib/price-sheets";
import { scanCompareSummary } from "@/lib/scan-compare";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = await docStoreStatus().catch((e) => ({ error: (e as Error).message }));
  const scanCompare = await scanCompareSummary().catch((e) => ({ error: (e as Error).message }));
  const priceSheets = await priceSheetSummary().catch((e) => ({ error: (e as Error).message }));
  return NextResponse.json({ store: store ?? { database: false }, ingest: ingestState(), scan_compare: scanCompare, price_sheets: priceSheets });
}
