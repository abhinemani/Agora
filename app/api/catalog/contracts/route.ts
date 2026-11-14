// Contracts, a page at a time: ?id=con_… for one contract's page (with &items= to
// search its item list), otherwise the explorer's search and filters. The catalog
// stays on the server (lib/catalog.ts); responses carry only the rows a page shows.

import { NextResponse } from "next/server";
import { exploreContracts, contractDetail, type ContractKind } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { withSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const KINDS = new Set(["coop", "federal", "state", "agency", "reseller"]);

// Read-only: it changes nothing in the store, so there is nothing to save afterwards.
export const GET = withSession((req: Request) => {
  const p = new URL(req.url).searchParams;
  const db = getDb();
  const id = p.get("id");
  if (id) {
    const contract = contractDetail(db, id, p.get("items") ?? "");
    return contract ? NextResponse.json({ contract }) : NextResponse.json({ contract: null }, { status: 404 });
  }
  const kind = p.get("kind") ?? "";
  return NextResponse.json(
    exploreContracts(db, {
      q: p.get("q") ?? "",
      coop: p.get("coop") ?? "",
      category: p.get("category") ?? "",
      kind: KINDS.has(kind) ? (kind as ContractKind) : "",
      usable: p.get("usable") === "1",
      priced: p.get("priced") === "1",
      readable: p.get("readable") === "1",
      offset: Number(p.get("offset")) || 0,
      limit: 25,
    }),
  );
}, { readOnly: true });
