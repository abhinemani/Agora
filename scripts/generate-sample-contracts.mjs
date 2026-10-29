// Generates the three sample contracts in seed/contracts/ as real PDF and XLSX
// files, so the upload flow parses genuine documents rather than fixtures.
//   node scripts/generate-sample-contracts.mjs

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "seed", "contracts");
mkdirSync(OUT, { recursive: true });

const NAVY = rgb(0.078, 0.129, 0.239);

/** Minimal flowing-text writer over pdf-lib. One drawText per line, so text
 * extractors see each line (and each table row) as a single run. */
async function makeDoc() {
  const pdf = await PDFDocument.create();
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  let page;
  let y;
  const M = 54;
  const W = 612 - M * 2;
  let pageNo = 0;

  function newPage() {
    page = pdf.addPage([612, 792]);
    pageNo += 1;
    y = 792 - M;
    page.drawText(`Page ${pageNo}`, { x: 612 - M - 40, y: 30, size: 8, font: sans, color: rgb(0.4, 0.4, 0.4) });
  }
  function ensure(h) {
    if (y - h < M) newPage();
  }
  function line(text, { font = sans, size = 10, gap = 4, color = rgb(0.1, 0.1, 0.1) } = {}) {
    ensure(size + gap);
    page.drawText(text, { x: M, y: y - size, size, font, color });
    y -= size + gap;
  }
  function para(text, opts = {}) {
    const font = opts.font ?? sans;
    const size = opts.size ?? 10;
    const words = text.split(/\s+/);
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > W) {
        line(cur, { font, size, gap: 3 });
        cur = w;
      } else cur = next;
    }
    if (cur) line(cur, { font, size, gap: 3 });
    y -= 6;
  }
  function heading(text) {
    y -= 6;
    line(text, { font: bold, size: 12, gap: 6, color: NAVY });
  }
  function title(text) {
    line(text, { font: bold, size: 16, gap: 10, color: NAVY });
  }
  function row(text) {
    line(text, { font: mono, size: 8.5, gap: 3 });
  }
  newPage();
  return { pdf, line, para, heading, title, row, newPage, bold, sans };
}

const pad = (s, n) => (s.length > n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lpad = (s, n) => (s.length > n ? s : " ".repeat(n - s.length) + s);

// ------------------------------------------------------------- 1. City furniture

async function cityFurniture() {
  const d = await makeDoc();
  d.title("CITY OF RIVERBEND");
  d.line("PRICE AGREEMENT FOR OFFICE AND PUBLIC SPACE FURNITURE", { font: d.bold, size: 11, gap: 10 });
  d.line("Contract No.: RB-2026-031");
  d.line("Contractor: Summit Workspace Interiors, 1180 Commerce Pkwy, Salem, OR 97301");
  d.line("Owner: City of Riverbend, Oregon");
  d.line("Effective Date: November 1, 2026");
  d.line("Expiration Date: October 31, 2029");
  d.line("Payment Terms: Net 30 days from receipt of a correct invoice");
  d.line("Delivery Terms: FOB Destination, inside delivery and installation included", { gap: 12 });

  d.heading("1. Scope");
  d.para(
    "The Contractor shall furnish, deliver and install office, meeting room and public space furniture for City departments at the prices set out in the Price Schedule (Section 6). Prices are firm for the first twelve months and may be adjusted annually thereafter by no more than the change in CPI-U.",
  );
  d.heading("2. Cooperative Use");
  d.para(
    "Cooperative Purchasing. Other public agencies may purchase goods and services under the terms and pricing of this Agreement with the consent of the Contractor. The City assumes no responsibility for orders placed by other agencies.",
  );
  d.heading("3. Warranty");
  d.para("All furniture carries a minimum ten-year warranty on frames and mechanisms and a two-year warranty on fabric and finishes.");
  d.heading("4. Delivery");
  d.para("Standard delivery is within 21 calendar days of order. Quick-ship items marked QS deliver within 7 calendar days.");
  d.heading("5. Insurance");
  d.para("Contractor shall maintain commercial general liability of $2,000,000 per occurrence and name the City as additional insured.");

  d.heading("6. Price Schedule");
  d.row(`${pad("ITEM NO.", 10)}${pad("DESCRIPTION", 44)}${pad("UOM", 5)}${lpad("UNIT PRICE", 14)}`);
  d.row("-".repeat(73));
  const rows = [
    ["SWI-D6030", "Desk, 60 x 30, laminate, modesty panel", "EA", "$412.00"],
    ["SWI-D7236", "Desk, 72 x 36, laminate, double pedestal", "EA", "$568.00"],
    ["SWI-RT48", "Return, 48 x 24, laminate", "EA", "$198.00"],
    ["SWI-SIT", "Height-adjustable desk, 60 x 30, electric", "EA", "$749.00"],
    ["SWI-TC100", "Task chair, mesh back, adjustable arms", "EA", "$289.00"],
    ["SWI-TC200", "Task chair, 24-hour, heavy-duty", "EA", "$465.00"],
    ["SWI-GC10", "Guest chair, sled base, upholstered", "EA", "$176.00"],
    ["SWI-STK4", "Stacking chair, poly, 4-leg (QS)", "EA", "$52.00"],
    ["SWI-CT96", "Conference table, 96 x 42, boat shape", "EA", "$1,180.00"],
    ["SWI-TT72", "Training table, 72 x 24, flip-top", "EA", "1-24 $212.00 / 25+ $198.00"],
    ["SWI-FT72", "Folding table, 72 x 30, heavy-duty (QS)", "EA", "$238.00"],
    ["SWI-LF36", "Lateral file, 36 in, 3-drawer", "EA", "$524.00"],
    ["SWI-BC72", "Bookcase, 72 in, 5-shelf", "EA", "$268.00"],
    ["SWI-LS3", "Lobby seating, 3-seat beam, steel", "EA", "$1,320.00"],
    ["SWI-PNL", "Acoustic panel, 48 x 66, fabric", "EA", "$342.00"],
    ["SWI-RD", "Reception desk, custom millwork", "EA", "Pricing per site survey"],
  ];
  for (const [sku, desc, uom, price] of rows) d.row(`${pad(sku, 10)}${pad(desc, 44)}${pad(uom, 5)}${lpad(price, 14)}`);
  d.line("");
  d.para("Installation is included in all unit prices above. Disposal of existing furniture: $18.00 per piece.");

  d.heading("7. Signatures");
  d.line("For the City: Marcus Reyes, Purchasing Manager");
  d.line("For the Contractor: Elena Park, President, Summit Workspace Interiors");
  writeFileSync(join(OUT, "riverbend-furniture-contract.pdf"), await d.pdf.save());
}

// ------------------------------------------------------------- 2. State office supplies

async function stateOfficeSupplies() {
  const d = await makeDoc();
  d.title("STATE OF OREGON");
  d.line("DEPARTMENT OF ADMINISTRATIVE SERVICES, PROCUREMENT SERVICES", { font: d.bold, size: 10, gap: 6 });
  d.line("STATEWIDE PRICE AGREEMENT: OFFICE SUPPLIES", { font: d.bold, size: 11, gap: 10 });
  d.line("Price Agreement No.: PA-5508-OP");
  d.line("Contractor: Riverside Office Supply, 88 River Rd, Riverbend, OR 97390");
  d.line("Owner: State of Oregon DAS");
  d.line("Effective Date: October 1, 2026");
  d.line("Expiration Date: September 30, 2029");
  d.line("Payment Terms: Net 30; 1% discount if paid within 10 days");
  d.line("Delivery Terms: FOB Destination; next business day for orders placed by 2 p.m.", { gap: 12 });

  d.heading("1. Authorized Purchasers");
  d.para(
    "This Price Agreement is available to all State agencies and to members of the Oregon Cooperative Procurement Program (ORCPP). Any ORCPP member, including cities, counties, special districts and school districts, may purchase from this agreement at the prices stated in Exhibit B.",
  );
  d.heading("2. Pricing");
  d.para(
    "Core list pricing is set out in Exhibit B, Price List, attached to this agreement as a spreadsheet. Volume pricing applies when ten or more units of the same item are ordered on a single order.",
  );
  d.para("OEM toner and ink cartridges: pricing per attached Schedule C, discount off manufacturer list.");
  d.para("Custom printed letterhead, envelopes and business cards: contact for quote.");
  d.para("Desk and wall calendars are offered at $4.50 to $7.25 each depending on style and size.");
  d.heading("3. Minimum Order and Returns");
  d.para("No minimum order. Unopened items may be returned within 30 days without a restocking fee.");
  d.heading("4. Sustainability");
  d.para("Contractor shall identify items with at least 30% post-consumer recycled content in its online catalog.");
  d.heading("5. Signatures");
  d.line("For the State: J. Alvarez, Chief Procurement Officer");
  d.line("For the Contractor: Ana Ruiz, Owner, Riverside Office Supply");
  writeFileSync(join(OUT, "state-office-supplies-contract.pdf"), await d.pdf.save());

  const header = ["SKU", "Description", "UOM", "Contract Price", "Volume Price (10+)"];
  const rows = [
    ["RVS-10010", "Copy paper, letter, 10-ream case, 92 bright", "CS", 44.95, 42.5],
    ["RVS-10020", "Copy paper, legal, 10-ream case", "CS", 58.4, 55.9],
    ["RVS-10030", "Copy paper, 30% recycled, letter, 10-ream case", "CS", 49.9, 47.25],
    ["RVS-20112", "Ballpoint pens, black, medium, box of 12", "BX", 5.1, 4.85],
    ["RVS-20114", "Ballpoint pens, blue, medium, box of 12", "BX", 5.1, 4.85],
    ["RVS-20210", "Gel pens, assorted, 8-pack", "PK", 9.75, ""],
    ["RVS-20310", "Highlighters, chisel tip, yellow, dozen", "DZ", 7.8, 7.2],
    ["RVS-20410", "Dry-erase markers, assorted, 12-pack", "PK", 13.2, 12.4],
    ["RVS-20510", "Permanent markers, fine, black, dozen", "DZ", 8.65, ""],
    ["RVS-30110", "Stapler, desktop, full strip", "EA", 14.9, ""],
    ["RVS-30120", "Staples, standard, 5000/box", "BX", 3.15, 2.9],
    ["RVS-30210", "Paper clips, #1, 100/box, 10 boxes", "PK", 4.4, ""],
    ["RVS-30455", "Binder clips, medium, box of 12", "BX", 2.65, 2.4],
    ["RVS-30455", "Binder clips, medium, box of 12", "BX", 2.65, 2.4],
    ["RVS-30510", "Tape, invisible, 3/4 in x 1000 in, 12 rolls", "PK", 21.6, 20.1],
    ["RVS-30610", "Scissors, 8 in, stainless", "EA", 6.2, ""],
    ["RVS-40110", "File folders, letter, 1/3 cut, box of 100", "BX", 12.75, 11.9],
    ["RVS-40120", "Hanging file folders, letter, box of 25", "BX", 15.4, 14.6],
    ["RVS-40210", "Binder, 1 in, view, white", "EA", 3.85, 3.5],
    ["RVS-40220", "Binder, 2 in, view, white", "EA", 5.6, 5.15],
    ["RVS-40310", "Index dividers, 8-tab, 24 sets", "PK", 18.9, ""],
    ["RVS-41870", "Sheet protectors, letter, box of 100", "BX", "12.49 / 13.99", ""],
    ["RVS-50110", "Sticky notes, 3 x 3 in, 12 pads", "PK", 9.95, 9.25],
    ["RVS-50210", "Legal pads, ruled, 12-pack", "PK", 14.5, 13.6],
    ["RVS-50310", "Spiral notebooks, college ruled, 6-pack", "PK", 11.25, ""],
    ["RVS-50410", "Envelopes, #10, security tint, box of 500", "BX", 24.8, 23.1],
    ["RVS-50420", "Envelopes, 9 x 12 catalog, box of 250", "BX", 29.4, 27.5],
    ["RVS-50510", "Shipping labels, laser, 2 x 4 in, 1000", "BX", 31.9, ""],
    ["RVS-60110", "Batteries, AA, 24-pack", "PK", 15.6, 14.4],
    ["RVS-60120", "Batteries, AAA, 24-pack", "PK", 15.6, 14.4],
    ["RVS-60210", "Desk organizer, mesh, 5-compartment", "EA", 17.2, ""],
    ["RVS-60310", "Calculator, desktop, 12-digit", "EA", 12.95, ""],
    ["RVS-60410", "Wall clock, 12 in, quiet sweep", "EA", 16.4, ""],
    ["RVS-60510", "Whiteboard eraser and cleaner kit", "EA", 8.9, ""],
    ["RVS-70110", "Surge protector, 6-outlet, 6 ft cord", "EA", 14.75, ""],
    ["RVS-70210", "USB flash drive, 64 GB", "EA", 9.2, 8.6],
    ["RVS-70310", "Keyboard and mouse combo, wireless", "EA", 28.5, 26.9],
    ["RVS-80110", "Breakroom paper plates, 9 in, 500", "CS", 34.2, ""],
    ["RVS-80210", "Hand sanitizer, 8 oz pump, case of 12", "CS", 27.6, 25.8],
    ["RVS-55120", "Paper shredder, cross-cut, 12-sheet", "EA", "Quote", ""],
  ];
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Exhibit B: Price List, PA-5508-OP, Riverside Office Supply"],
    [],
    header,
    ...rows,
  ]);
  sheet["!cols"] = [{ wch: 12 }, { wch: 48 }, { wch: 6 }, { wch: 15 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Exhibit B");
  writeFileSync(join(OUT, "state-office-supplies-exhibit-b.xlsx"), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ------------------------------------------------------------- 3. Co-op janitorial

async function coopJanitorial() {
  const d = await makeDoc();
  d.title("WESTERN STATES PURCHASING COOPERATIVE");
  d.line("MASTER AGREEMENT: JANITORIAL SUPPLIES AND EQUIPMENT", { font: d.bold, size: 11, gap: 10 });
  d.line("Agreement Number: WSPC-JN-1125");
  d.line("Supplier: Northwest Sanitary Supply, Inc., Tacoma, WA");
  d.line("Owner: Western States Purchasing Cooperative");
  d.line("Term: January 1, 2026 through December 31, 2028, with two optional one-year renewals");
  d.line("Payment Terms: Net 45");
  d.line("Delivery Terms: FOB Destination, freight prepaid on orders over $250", { gap: 12 });

  d.heading("Article 1. Participating Agencies");
  d.para(
    "Any public agency, including any city, county, special district, school district or tribal government, may use this Master Agreement upon registering with the Cooperative. Participating agencies shall order directly from the Supplier and are solely responsible for their own orders.",
  );
  d.heading("Article 2. Pricing");
  d.para(
    "Neutral floor cleaner concentrate shall be supplied at $18.40 per gallon. Glass cleaner, ready to use, quart spray bottle, will be priced at $3.85 each. Hydrogen peroxide disinfectant cleaner is $24.60 per gallon. The Supplier shall furnish 33 x 40 in trash can liners, 1.5 mil, at $31.75 per case of 200.",
  );
  d.para(
    "Floor machines, including auto scrubbers and burnishers, are priced from $1,850 to $3,400 depending on configuration. Equipment repair labor will be quoted on request. Custom chemical dispensing systems: contact for quote.",
  );
  d.heading("Article 3. Price Schedule (consumables)");
  d.row("Item#      Product                                   Pack        Price");
  d.row("NWS-2210   Toilet tissue, 2-ply, 500 sheets          96/cs      $68.90");
  d.row("NWS-2215   Jumbo roll tissue, 9 in                   12/cs");
  d.row("                                                              $52.40");
  d.row("NWS-2310   Multifold towels, white                   4000/cs    $39.95");
  d.row("NWS-2320   Hardwound roll towels, 8 in x 800 ft      6 rl/cs     $47.10");
  d.row("NWS-2410 Foam hand soap refill 1250 mL  4/cs  $46.80");
  d.row("NWS-2510   Microfiber cloths, 16 x 16 in             24/pk      $21.60");
  d.row("NWS-2520   Microfiber flat mop pads, 18 in           12/pk      $38.25");
  d.row("NWS-2610   Wet mop head, cotton blend, 24 oz          ea         $7.10");
  d.row("NWS-2710   Nitrile gloves, powder-free, L            1000/cs    $64.00");
  d.row("NWS-2810   Urinal screens, deodorizing                12/bx    $19.20");
  d.row("NWS-2910   Odor counteractant, aerosol               12/cs      TBD");
  d.line("");
  d.heading("Article 4. Training");
  d.para("Supplier shall provide on-site product and safety training at no charge to participating agencies ordering more than $5,000 annually.");
  writeFileSync(join(OUT, "coop-janitorial-contract.pdf"), await d.pdf.save());
}

await cityFurniture();
await stateOfficeSupplies();
await coopJanitorial();
console.log("Wrote sample contracts to", OUT);
