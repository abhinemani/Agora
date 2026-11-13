/** The home hero's blueprint: a drafting grid, a civic building in elevation, and a
 * rec-center plan laid out for the worked example. Decorative, but every number on it
 * is real: the title block and dimension labels come from the catalog. The side drawings
 * appear only where the gutters can hold them; phones get a sheet border, a small city hall,
 * and the title block along the bottom. */
const LINE = "#FFFFFF";
const MONO = "'Roboto Mono', ui-monospace, monospace";

function Reg({ x, y }: { x: number; y: number }) {
  return (
    <>
      <circle cx={x} cy={y} r={7} />
      <path d={`M${x - 12} ${y} H${x + 12} M${x} ${y - 12} V${y + 12}`} />
    </>
  );
}

/** A horizontal dimension line with end ticks and arrowheads. */
function DimH({ x1, x2, y, label }: { x1: number; x2: number; y: number; label?: string }) {
  return (
    <>
      <path d={`M${x1} ${y} H${x2} M${x1} ${y - 6} V${y + 6} M${x2} ${y - 6} V${y + 6}`} />
      <path d={`M${x1} ${y} l7 -3 v6 z M${x2} ${y} l-7 -3 v6 z`} fill={LINE} />
      {label && (
        <text x={(x1 + x2) / 2} y={y - 8} textAnchor="middle" fill={LINE} stroke="none">
          {label}
        </text>
      )}
    </>
  );
}

function DimV({ x, y1, y2 }: { x: number; y1: number; y2: number }) {
  return (
    <>
      <path d={`M${x} ${y1} V${y2} M${x - 6} ${y1} H${x + 6} M${x - 6} ${y2} H${x + 6}`} />
      <path d={`M${x} ${y1} l-3 7 h6 z M${x} ${y2} l-3 -7 h6 z`} fill={LINE} />
    </>
  );
}

/** City hall in elevation, with its dimension lines. */
function CityHall() {
  const columns = Array.from({ length: 6 }, (_, i) => 112 + i * 30);
  return (
    <>
      <path d="M30 470 H360" />
      <rect x="82" y="455" width="216" height="15" />
      <rect x="92" y="440" width="196" height="15" />
      <rect x="100" y="430" width="180" height="10" />
      {columns.map((x) => (
        <rect key={x} x={x} y="330" width="10" height="100" />
      ))}
      <rect x="96" y="315" width="188" height="15" />
      <path d="M96 315 L190 262 L284 315 Z" />
      <path d="M126 306 L190 271 L254 306 Z" strokeDasharray="3 3" />
      <rect x="152" y="222" width="76" height="38" />
      <path d="M152 222 A38 38 0 0 1 228 222" />
      <rect x="184" y="172" width="12" height="14" />
      <path d="M190 172 V160" />
      <circle cx="190" cy="222" r="58" strokeDasharray="2 5" strokeWidth="0.8" />
      <path d="M190 140 V490" strokeDasharray="10 4 2 4" strokeWidth="0.8" />
      <DimV x={56} y1={160} y2={470} />
      <DimH x1={96} x2={284} y={498} />
    </>
  );
}

export function BlueprintBackdrop({
  contracts,
  suppliers,
  products,
  vehicles,
  priceRange,
}: {
  contracts: number;
  suppliers: number;
  products: number;
  vehicles: number;
  /** The worked example's price spread, e.g. "$249–$264 each". */
  priceRange?: string;
}) {
  const tables = Array.from({ length: 40 }, (_, i) => ({ x: 1136 + (i % 8) * 30, y: 176 + Math.floor(i / 8) * 38 }));
  const ink = { fill: "none", stroke: LINE, strokeWidth: 1.1, fontFamily: MONO, fontSize: 11, letterSpacing: 1.5 } as const;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {/* Drafting grid, faded toward the center so the headline stays clean */}
      <svg viewBox="0 0 1440 640" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <pattern id="bp-minor" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M16 0H0V16" fill="none" stroke={LINE} strokeWidth="0.6" />
          </pattern>
          <pattern id="bp-major" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M80 0H0V80" fill="none" stroke={LINE} strokeWidth="1" />
          </pattern>
          <radialGradient id="bp-fade-g" cx="720" cy="300" r="640" gradientUnits="userSpaceOnUse" gradientTransform="translate(720 300) scale(1 0.5) translate(-720 -300)">
            <stop offset="0" stopColor="#262626" />
            <stop offset="0.45" stopColor="#3a3a3a" />
            <stop offset="1" stopColor="#ffffff" />
          </radialGradient>
          <mask id="bp-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="1440" height="640">
            <rect width="1440" height="640" fill="url(#bp-fade-g)" />
          </mask>
        </defs>
        <g mask="url(#bp-fade)" opacity="0.5">
          <rect width="1440" height="640" fill="url(#bp-minor)" opacity="0.14" />
          <rect width="1440" height="640" fill="url(#bp-major)" opacity="0.26" />
        </g>
      </svg>

      {/* On a phone: a sheet border and a small city hall, so it reads as a drawing */}
      <div className="absolute inset-3 border border-white/25 md:hidden" />
      <svg viewBox="70 150 290 330" className="absolute bottom-7 left-6 w-[118px] opacity-[0.6] md:hidden">
        <g {...ink} strokeWidth={1.6}>
          <CityHall />
        </g>
      </svg>

      {/* Registration marks, pinned to the corners where there's room for a full sheet */}
      <svg viewBox="0 0 40 40" className="absolute left-2.5 top-2.5 hidden h-10 w-10 opacity-[0.55] md:block">
        <g {...ink}>
          <Reg x={20} y={20} />
        </g>
      </svg>
      <svg viewBox="0 0 40 40" className="absolute right-2.5 top-2.5 hidden h-10 w-10 opacity-[0.55] md:block">
        <g {...ink}>
          <Reg x={20} y={20} />
        </g>
      </svg>

      {/* City hall, east elevation: only where the left gutter has room for it */}
      <svg viewBox="20 150 360 470" className="absolute left-6 top-[110px] hidden w-[280px] opacity-[0.55] min-[1400px]:block">
        <g {...ink}>
          <CityHall />
          <text x="82" y="530" fill={LINE} stroke="none">
            CITY HALL · EAST ELEVATION
          </text>
          <circle cx="70" cy="585" r="18" />
          <path d="M70 562 L76 585 L70 580 L64 585 Z" fill={LINE} />
          <text x="70" y="556" textAnchor="middle" fill={LINE} stroke="none">
            N
          </text>
          <text x="104" y="589" fill={LINE} stroke="none">
            FIG. 1
          </text>
        </g>
      </svg>

      {/* Rec center plan, laid out for the worked example's 40 folding tables */}
      <svg viewBox="1100 105 310 305" className="absolute right-6 top-[110px] hidden w-[280px] opacity-[0.55] min-[1400px]:block">
        <g {...ink}>
          <rect x="1110" y="140" width="280" height="240" />
          <rect x="1116" y="146" width="268" height="228" />
          <path d="M1222 374 A40 40 0 0 1 1262 334" strokeDasharray="3 3" />
          <path d="M1262 374 V334" />
          <g strokeWidth="0.9">
            {tables.map((t) => (
              <rect key={`${t.x}-${t.y}`} x={t.x} y={t.y} width="22" height="9" />
            ))}
          </g>
          <DimH x1={1110} x2={1390} y={122} label={priceRange?.toUpperCase()} />
          <text x="1110" y="404" fill={LINE} stroke="none">
            REC CENTER · 40 FOLDING TABLES
          </text>
        </g>
      </svg>

      {/* Title block: the catalog's real counts */}
      <svg viewBox="1124 514 282 90" className="absolute bottom-7 right-6 w-[200px] opacity-[0.7] md:bottom-5 md:w-[270px] md:opacity-[0.55]">
        <g {...ink}>
          <rect x="1130" y="520" width="270" height="78" />
          <path d="M1130 546 H1400 M1130 572 H1400 M1262 520 V598" />
          <g fill={LINE} stroke="none">
            <text x="1142" y="538">AGORA</text>
            <text x="1274" y="538">SHEET A-01</text>
            <text x="1142" y="564">{contracts} CONTRACTS</text>
            <text x="1274" y="564">{suppliers} SUPPLIERS</text>
            <text x="1142" y="590">{products.toLocaleString()} PRODUCTS</text>
            <text x="1274" y="590">{vehicles} VEHICLES</text>
          </g>
        </g>
      </svg>
    </div>
  );
}

/** Corner registration ticks and a dimension line, drawn around the search box. */
export function DimensionFrame({ label, children }: { label: string; children: React.ReactNode }) {
  const tick = "pointer-events-none absolute h-3.5 w-3.5 border-[#CFE0F5]";
  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-[34px] flex h-3 items-center gap-2.5 font-mono text-[11px] tracking-[0.12em] text-[#CFE0F5]">
        <span className="relative h-0 flex-1 border-t border-[#CFE0F5]">
          <span className="absolute -top-1.5 left-0 h-3 border-l border-[#CFE0F5]" />
        </span>
        <span className="whitespace-nowrap">{label}</span>
        <span className="relative h-0 flex-1 border-t border-[#CFE0F5]">
          <span className="absolute -top-1.5 right-0 h-3 border-l border-[#CFE0F5]" />
        </span>
      </div>
      <span aria-hidden="true" className={`${tick} -left-2.5 -top-2.5 border-l border-t`} />
      <span aria-hidden="true" className={`${tick} -right-2.5 -top-2.5 border-r border-t`} />
      <span aria-hidden="true" className={`${tick} -bottom-2.5 -left-2.5 border-b border-l`} />
      <span aria-hidden="true" className={`${tick} -bottom-2.5 -right-2.5 border-b border-r`} />
      {children}
    </div>
  );
}
