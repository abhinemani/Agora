// The catalog's size and its products per category, for the home page's counts (the catalog stays on the server).
import { NextResponse } from "next/server";
import { catalogBrowseCategories, catalogTotals } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ...catalogTotals(), categories: catalogBrowseCategories().map(({ name, products }) => ({ name, products })) });
}
