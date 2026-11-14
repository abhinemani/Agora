// Tracked redirect to a contract's own page. Every outbound click is logged
// (agency, contract, co-op, request, time) so Sovra can show each co-op the
// traffic it sends, then the buyer is forwarded to the contract.

import { NextResponse } from "next/server";
import { logClick } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const from = new URL(req.url).searchParams;
  const hit = logClick({ contractId: id, listingId: from.get("listing"), requestId: from.get("request"), offeringId: from.get("offering") });
  if (!hit) return new NextResponse("This contract has no link on file yet.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return NextResponse.redirect(hit.url, 302);
}
