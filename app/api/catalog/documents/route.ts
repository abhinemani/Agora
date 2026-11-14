// The price-list queue, a page at a time: ?coop=GSA%20MAS&kind=htm&q=canon&offset=0.

import { NextResponse } from "next/server";
import { priceListQueue } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  return NextResponse.json(
    priceListQueue({
      coop: p.get("coop") || undefined,
      kind: p.get("kind") || undefined,
      q: (p.get("q") ?? "").slice(0, 80),
      offset: Math.max(0, Number(p.get("offset")) || 0),
      limit: 25,
    }),
  );
}
