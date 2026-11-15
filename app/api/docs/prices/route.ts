// The item prices read from the state programs' price sheets (lib/price-sheets.ts), a page at a time, for
// npm run import:doc-prices to bring into the repository. Every row is a price printed on a public contract document,
// with the line it is printed on; nothing anyone typed.
import { NextResponse, type NextRequest } from "next/server";
import { exportPrices } from "@/lib/price-sheets";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0);
  const limit = Math.min(10_000, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 10_000) || 10_000));
  return NextResponse.json(await exportPrices(offset, limit));
}
