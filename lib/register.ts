// An agency's contract register: one contract per row (title, vendor, number,
// category, dates, ceiling, link), uploaded as CSV or XLSX by the purchasing
// admin. Columns are found by their usual names, every row is validated, and
// the rows that can't be mapped come back in a report instead of being guessed at.

export type RegisterField = "title" | "vendor" | "number" | "category" | "start" | "end" | "ceiling" | "url";

const HEADERS: Record<RegisterField, RegExp> = {
  title: /^(contract( name| title)?|title|description|name|commodity|service|goods?\/services?)$/i,
  vendor: /^(vendor|supplier|contractor|company|awardee|vendor name|supplier name)$/i,
  number: /^(contract ?(#|no\.?|number|id)|number|#|id|po ?#?)$/i,
  category: /^(category|type|commodity code|class)$/i,
  start: /^(start( date)?|effective( date)?|begin( date)?|term start|award date)$/i,
  end: /^(end( date)?|expir(es|ation)( date)?|term end|through)$/i,
  ceiling: /^(ceiling|not to exceed|nte|amount|value|max(imum)?( amount)?|contract value|total)$/i,
  url: /^(url|link|document|file|contract link)$/i,
};

export interface RegisterRow {
  row: number;
  title: string;
  vendor: string;
  number: string;
  category: string;
  start: string;
  end: string;
  ceiling: number | null;
  url: string;
  /** Imported, but worth a look (e.g. already expired). */
  warnings: string[];
}

export interface RegisterIssue {
  row: number;
  problem: string;
  text: string;
}

export interface RegisterParse {
  header_row: number;
  columns: Partial<Record<RegisterField, string>>;
  rows: RegisterRow[];
  issues: RegisterIssue[];
}

export class RegisterError extends Error {}

const cell = (v: unknown) => (v == null ? "" : String(v).trim());

/** "2027-06-30", "6/30/2027", "June 30, 2027" or an Excel serial day → "2027-06-30". */
export function toIsoDate(v: unknown): string | null {
  const s = cell(v);
  if (!s) return "";
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(s)) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  const t = Date.parse(s);
  if (!Number.isNaN(t) && /[a-z]/i.test(s) && /\d{4}/.test(s)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** "$85,000", "85000", "85,000.00" → 85000. Ranges and words aren't amounts. */
export function toAmount(v: unknown): number | null | undefined {
  const s = cell(v);
  if (!s) return null;
  const m = s.replace(/usd/i, "").match(/^\$?\s*([\d,]+(\.\d+)?)\s*$/);
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

export function parseRegister(table: unknown[][], today = new Date().toISOString().slice(0, 10)): RegisterParse {
  // The header is the first row naming at least a title and a vendor column.
  let headerRow = -1;
  let map: Partial<Record<RegisterField, number>> = {};
  for (let r = 0; r < Math.min(table.length, 15); r++) {
    const found: Partial<Record<RegisterField, number>> = {};
    (table[r] ?? []).forEach((h, i) => {
      const name = cell(h).replace(/\s+/g, " ");
      for (const f of Object.keys(HEADERS) as RegisterField[]) if (found[f] === undefined && HEADERS[f].test(name)) found[f] = i;
    });
    if (found.title !== undefined && found.vendor !== undefined) {
      headerRow = r;
      map = found;
      break;
    }
  }
  if (headerRow < 0)
    throw new RegisterError("Couldn't find the header row. The register needs at least a contract title column and a vendor column (for example “Contract Name” and “Vendor”).");

  const columns = Object.fromEntries(Object.entries(map).map(([f, i]) => [f, cell(table[headerRow][i!])])) as RegisterParse["columns"];
  const rows: RegisterRow[] = [];
  const issues: RegisterIssue[] = [];
  const get = (r: unknown[], f: RegisterField) => (map[f] === undefined ? "" : r[map[f]!]);

  for (let r = headerRow + 1; r < table.length; r++) {
    const raw = table[r] ?? [];
    if (raw.every((v) => !cell(v))) continue;
    const rowNum = r + 1;
    // Spreadsheet readers turn dates into serial day numbers; show them as dates again.
    const text = raw.map((v) => (/^\d{5}$/.test(cell(v)) ? toIsoDate(v) : cell(v))).filter(Boolean).join(" | ");
    const title = cell(get(raw, "title"));
    const vendor = cell(get(raw, "vendor"));
    const start = toIsoDate(get(raw, "start"));
    const end = toIsoDate(get(raw, "end"));
    const ceiling = toAmount(get(raw, "ceiling"));
    const problems: string[] = [];
    if (!title) problems.push("no contract title");
    if (!vendor) problems.push("no vendor");
    if (start === null) problems.push(`start date “${cell(get(raw, "start"))}” isn't a date`);
    if (end === null) problems.push(`end date “${cell(get(raw, "end"))}” isn't a date`);
    if (start && end && end < start) problems.push("ends before it starts");
    if (ceiling === undefined) problems.push(`ceiling “${cell(get(raw, "ceiling"))}” isn't a single amount`);
    if (problems.length) {
      issues.push({ row: rowNum, problem: problems.join("; "), text });
      continue;
    }
    const warnings: string[] = [];
    if (end && end < today) warnings.push("already expired, so it's hidden from search");
    if (!end) warnings.push("no end date");
    rows.push({
      row: rowNum,
      title,
      vendor,
      number: cell(get(raw, "number")),
      category: cell(get(raw, "category")),
      start: start ?? "",
      end: end ?? "",
      ceiling: ceiling ?? null,
      url: cell(get(raw, "url")),
      warnings,
    });
  }
  return { header_row: headerRow + 1, columns, rows, issues };
}
