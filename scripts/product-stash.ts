// Which catalog products are served, and which are stashed until they can be cleaned up.
//
// A product stays live when it has a price a buyer could act on (or a labelled list price), a name that says what it
// is, and is something bought by the unit. The rest are stashed: the catalog importer (scripts/import-catalog.ts)
// leaves them out of seed/catalog/catalog.json.gz and counts them in seed/stash/products/summary.json. Nothing is
// deleted: the rows stay in the source files, and AGORA_INCLUDE_STASHED=1 brings them all back.
//
// Contracts are never stashed here. A co-op whose products are all stashed (PEPPM, HGACBuy) still shows its contracts
// as routes, and a contract page still links to the co-op's own price documents.

export interface StashOffering {
  coop: string;
  price: number | null;
  list: number | null;
  unit: string | null;
  category: string | null;
}
export interface StashProduct {
  name: string;
  maker: string | null;
  mpn: string | null;
  /** What the AI review found the product to be (scripts/product-kind.ts), when it was confident. */
  role?: string;
  /** The review's role when it was not confident: used only to keep a product out, never to let one in. */
  doubtful_role?: string;
  /** The packaged-service review's verdict (task package-check): product, package, rate, mix or project, and whether
   * it was confident. Only service lines and project-like state-program lines carry one. */
  package?: { verdict: string; sure: boolean };
}

/** The reasons, in the order they are tested. The keys are stable (summary.json, /data); the text is what a reader sees. */
export const STASH_REASONS = {
  peppm: "PEPPM items: no price (behind the member login), a sample of each contract, many named only by a category or a part number",
  hgacbuy: "HGACBuy items: no price (a discount with no list price to apply it to, or by quote)",
  no_price: "Items with no price of any kind",
  burke_parts: "Burke playground components the review did not code (by part-number family: everything but 550 to 599)",
  crash_parts: "Items on New York's crash-mitigation award the review did not code",
  canon_extras: "Canon licences, service plans and accessories the review did not code",
  rates: "Rate lines, not products: hourly and monthly rates, fares, per-minute calls, rentals, fees and multi-year service prices",
  reviewed_parts: "Parts and accessories, by the AI review: a component or an add-on of something else (a swing hanger, a copier finisher, a vehicle option)",
  reviewed_services: "Rates and services, by the AI review: hourly and per-unit rates, installation, training, a study",
  not_a_package: "Service lines that are not a fixed package, by the packaged-service review: time-based rates, goods mixed with labor, and one agency's own project line items",
  reviewed_doubtful: "Products the AI review thought, without confidence, were a part, an accessory, a rate or a service (doubt keeps a product out; it never lets one in)",
} as const;
export type StashReason = keyof typeof STASH_REASONS;

/** Units that price time or a service, not a thing. */
const RATE_UNIT = /^(hours?|hr|hourly|minutes?|days?|weeks?|months?|monthly|quarter|years?|annual|task|fare|miles?|trip|visit|per person|per page|kwh|btu|therm|acre)\b/i;
/** Words that mark a rate or a service in an item's own name. Kept narrow: a "sign support", a "repair kit", a
 * "training table" and a "Special Services Pickup" are products. */
const RATE_NAME =
  /\b(hourly|labor|rate|rental|training(?! (table|chair|room|desk))|repairs|(?<!special )services|service agreement|maintenance (and|&) support|maintenance agreement|fee|fees|warranty|subscription|airfare|call to|option period|year (\d|one|two|three|four|five))\b/i;
/** Awards that are services through and through, whose lines are priced each or by the job. */
const SERVICE_AWARD =
  /^(Air Travel Services|Moving Services|Long Distance Telephone Services|Intrastate Commercial Car Rental|Temporary Staffing Services|Security Services|Security Guard Services|Publication of Public Notices|Parking Lots and Structures Striping|Solid Waste Disposal)/i;
/** Canon's price-file sections that hold machines and what they consume. */
const CANON_KEEP = /^(Printer|Scanner)\b|Supplies (and|&) Consumables/;

/** Why an offering is stashed, or null when it is served. `contractTitle` is its contract's title.
 *
 * Three hard rules come first: no price, a co-op whose items carry none (PEPPM, HGACBuy), and a line priced by time or
 * a service award. Then the AI review's role decides wherever it gave a confident answer (scripts/product-kind.ts):
 * whole items and consumables are served, parts, accessories, rates and services are not. The patterns after it
 * (Burke's part families, the crash-mitigation award, Canon's sections, words in names) only decide for products the
 * review could not code. */
export function stashReason(o: StashOffering, p: StashProduct, contractTitle: string): StashReason | null {
  if (o.coop === "PEPPM") return "peppm";
  if (o.coop === "HGACBuy") return "hgacbuy";
  if (o.price == null && o.list == null) return "no_price";
  if (RATE_UNIT.test(o.unit ?? "")) return "rates";
  // Canon's own price-file sections say what a line is: software licences stay out, whatever role a reviewer gave them
  // (reviewers split on licences: item or accessory). Its service and maintenance plans are judged as packages below.
  if (o.coop === "Sourcewell" && /canon/i.test(p.maker ?? "") && /^(Software|Speed License)\b/.test(o.category ?? "")) return "canon_extras";
  // The product owner's rule: a service sold as a fixed package counts as a product; a time-based rate, goods mixed
  // with labor, or one agency's project line does not. A doubtful "not a package" keeps the line out too.
  if (p.package) {
    const ok = p.package.verdict === "product" || p.package.verdict === "package";
    if (!ok) return "not_a_package";
    if (p.package.sure) return null;
  }
  // Awards that are services through and through (fares, moving, staffing): out unless the review found a package.
  if (SERVICE_AWARD.test(contractTitle)) return "rates";
  if (p.role === "item" || p.role === "consumable") return null;
  if (p.role === "part" || p.role === "accessory") return "reviewed_parts";
  if (p.role === "rate" || p.role === "service") return "reviewed_services";
  if (!p.role && p.doubtful_role && p.doubtful_role !== "item" && p.doubtful_role !== "consumable") return "reviewed_doubtful";
  if (o.coop === "OMNIA Partners" && /burke/i.test(p.maker ?? "")) {
    // Burke numbers its parts by family: under 200 are bolts, posts and panels; 200 to 549 and 600 up are pieces of a
    // play structure; 550 to 599 stand on their own (swings, spinners, benches, tables, bike racks, ball games).
    const family = Number((p.mpn ?? "").split("-")[0]);
    if (!(family >= 550 && family <= 599)) return "burke_parts";
  }
  if (o.coop === "NYS OGS" && /Crash Mitigation/i.test(contractTitle)) return "crash_parts";
  if (o.coop === "Sourcewell" && /canon/i.test(p.maker ?? "")) {
    const section = o.category ?? "";
    // The few machines the capture filed under no section (imageRUNNER, imageFORCE) carry no category.
    if (!(section === "" || CANON_KEEP.test(section)) || RATE_NAME.test(p.name) || /\b(install|installation|ecarepak|license|licence)\b/i.test(p.name)) return "canon_extras";
  }
  if (RATE_NAME.test(p.name)) return "rates";
  return null;
}
