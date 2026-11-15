// The browse page's shelf: every category with its counts, and one category's catalog products a page at a time
// (?category=Furniture&q=chair&offset=0). The catalog stays on the server (lib/catalog.ts); a page carries 50 rows.

import { NextResponse } from "next/server";
import { catalogBrowse, catalogBrowseCategories, catalogRetrieved } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const categories = catalogBrowseCategories();
  const category = categories.some((c) => c.name === p.get("category")) ? p.get("category")! : "Furniture";
  const { total, items } = catalogBrowse(category, (p.get("q") ?? "").slice(0, 100), Math.max(0, Number(p.get("offset")) || 0), 50);
  return NextResponse.json({ categories, category, total, items, retrieved: catalogRetrieved() });
}
