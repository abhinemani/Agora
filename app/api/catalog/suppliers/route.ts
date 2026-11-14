// Co-op catalog suppliers, a few at a time: ?q=tyler to search, ?id=cat_… for one
// supplier's storefront data, ?for=sup_… for the catalog record behind one of
// Agora's own suppliers. The catalog itself stays on the server (lib/catalog.ts).

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { catalogStorefront, catalogSupplierFor, searchCatalogSuppliers } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const db = getDb();
  const id = url.searchParams.get("id");
  const forId = url.searchParams.get("for");
  if (id || forId) {
    let catalogId = id;
    if (forId) {
      const s = db.suppliers.find((x) => x.id === forId);
      catalogId = s ? (s.id.startsWith("cat_") ? s.id : (catalogSupplierFor(s)?.id ?? null)) : null;
    }
    const storefront = catalogId ? catalogStorefront(db, catalogId) : null;
    return storefront ? NextResponse.json({ storefront }) : NextResponse.json({ storefront: null }, { status: id ? 404 : 200 });
  }
  const q = (url.searchParams.get("q") ?? "").slice(0, 80);
  return NextResponse.json({ results: searchCatalogSuppliers(q, 12) });
}
