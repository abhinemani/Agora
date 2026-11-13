// Data model for the Agora prototype. Mirrors section 5 of the build spec.

export type Source =
  | "own_contract"
  | "state_contract"
  | "coop_contract"
  | "reseller"
  | "gsa"
  | "no_approval";

export type ContractSource = Exclude<Source, "no_approval">;

export type EdgeTier = "discover" | "win" | "position";

export type Role = "buyer" | "procurement" | "supplier";

export type EntityType = "municipality" | "county" | "school_district" | "special_district" | "state_agency";

/** Who is buying, asked at intake. Decides which contracts they may use. */
export interface Buyer {
  name: string;
  /** Two-letter state code. */
  state: string;
  entity_type: EntityType;
  population: number | null;
  /** Website domain, matched against co-op member lists to detect memberships. */
  domain?: string;
}

/** Who may buy from a contract vehicle. */
export interface Eligibility {
  /** Two-letter state codes, or "any" for national co-ops. */
  states: string[] | "any";
  entity_types?: EntityType[];
  /** Only these named agencies (an agency's own, non-piggybackable contract). */
  agencies?: string[];
  /** Plain-language rule shown to buyers, e.g. "New Jersey public entities". */
  note: string;
  /** Anything the buyer must have first, e.g. a free co-op membership. */
  requires?: string;
}

export type Payer = "local_government" | "supplier" | "card_network" | "partner";

export const CATEGORIES = [
  "Office supplies",
  "Furniture",
  "Janitorial",
  "IT hardware",
  "Software and services",
  "Facilities and MRO",
  "Fleet and parts",
  "Public works materials",
  "Safety and uniforms",
  "Professional services",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Agency {
  id: string;
  name: string;
  population: number;
  budget: number;
  quick_buy_threshold: number;
  preferences: { local: boolean; mbe: boolean; sustainable: boolean };
  departments: { id: string; name: string; address: string }[];
}

export interface CityMarketplace {
  id: string;
  agency_name: string;
  distance_miles: number;
}

export interface Supplier {
  id: string;
  name: string;
  city: string;
  state: string;
  is_local: boolean;
  certifications: string[];
  verified: { insurance: boolean; bond: boolean };
  edge_tier: EdgeTier;
  rating: number;
  review_count: number;
  sponsored: boolean;
  categories: Category[];
  /** A featured storefront's own copy. Absent for a basic storefront. */
  profile?: SupplierProfile;
  website?: string;
}

export interface SupplierProfile {
  tagline: string;
  about: string;
  /** Families (Listing.family) shown first on the storefront. */
  featured_families?: string[];
  /** Shown under the storefront header, e.g. where the content comes from. */
  disclaimer?: string;
}

export interface Review {
  id: string;
  supplier_id: string;
  agency_name: string;
  rating: number;
  text: string;
  date: string;
  response?: string;
}

export interface Contract {
  id: string;
  supplier_id: string;
  source: ContractSource;
  owner: string;
  title: string;
  contract_number: string;
  start: string;
  end: string;
  piggybackable: boolean;
  piggyback_clause_text: string;
  payment_terms: string;
  delivery_terms: string;
  marketplace_ids: string[];
  source_document_id: string | null;
  /** Whether option 2 (onboarding) has been billed for this contract. */
  onboarding_billed: boolean;
  /** Short purchasing-program name shown on routes, e.g. "NJSTART", "Sourcewell". */
  vehicle?: string;
  eligibility?: Eligibility;
  /** How a buyer gets a price: a published schedule, a discount off list, or a quote. */
  pricing_basis?: "published_price" | "discount_from_list" | "quote";
  /** Where the terms come from: a source document we hold, research to verify, or demo data. */
  verification?: "source_document" | "research_lead" | "demo" | "agency_register";
  source_url?: string;
  /** Master agreement other states can adopt, e.g. "NASPO ValuePoint AR3758". */
  master_agreement?: string;
  /** Route covers every product the supplier sells (e.g. a discount-off-list co-op award). */
  covers_supplier_catalog?: boolean;
  /** A state's participating addendum to another contract in Agora, at that contract's published prices. */
  adopts?: string;
  /** Plain-language note on how this contract relates to others, shown on product pages. */
  relation_note?: string;
  /** Source documents: master agreement, price files, participating addenda. */
  documents?: { label: string; url: string }[];
  /** The co-op that awarded it (co-op contracts only). */
  coop_id?: string;
  /** Scope words beyond the title, e.g. the categories a master agreement covers. */
  scope?: string;
  /** Added from this agency's contract register; visible only to that agency. */
  register_of?: string;
  /** Not-to-exceed amount from the register, if given. */
  ceiling?: number;
}

/** A purchasing cooperative. Agora sends buyers to its contract pages rather
 * than selling through it, so the co-op sees the traffic, unless the co-op has
 * agreed to let its members buy inside Agora. */
export interface Coop {
  id: string;
  name: string;
  website: string;
  /** Whether the co-op shares its member list; no formal relationship without one. */
  member_list_status: "none" | "partial" | "full";
  /** Where the member list came from. "demo" lists are illustrative, not from the co-op. */
  member_list_source?: "co-op" | "scraped" | "demo";
  members?: { name: string; domain: string }[];
  /** How agencies get on it: a membership, or their state signing a participating addendum (NASPO ValuePoint). */
  access?: "membership" | "state_addendum";
  /** Members may check out or request quotes in Agora. Off unless the co-op has agreed. */
  buy_in_agora: boolean;
  /** Plain-language status shown to Sovra ops. */
  note: string;
}

/** An agency's membership in a co-op: detected from a member list, or added by the agency. */
export interface CoopMembership {
  agency: string;
  coop_id: string;
  source: "detected" | "manual";
  /** The purchasing admin has confirmed it. Detected memberships count before confirmation. */
  confirmed: boolean;
}

/** A requester asked purchasing to get the agency onto a co-op contract. */
export interface Referral {
  id: string;
  request_id: string | null;
  contract_id: string;
  coop_id: string;
  agency: string;
  need: string;
  fit: number;
  created_at: string;
}

/** A co-op contract shown in results, for traffic reporting. */
export interface Impression {
  request_id: string;
  contract_id: string;
  coop_id: string;
  agency: string | null;
  rank: number;
  fit: number;
  member: boolean;
  created_at: string;
}

/** Per-agency setup: plan, free-tier usage and whether staff see sponsored placements. */
export interface AgencySettings {
  agency: string;
  plan: "free" | "paid";
  /** Year the RFP counter covers; it resets when the year turns. */
  rfp_year: number;
  /** Solicitations published this year, counted against the free plan's limit. */
  rfp_used: number;
  /** Hide sponsored placements from staff (paid plans only). */
  ad_free: boolean;
}

/** A requester asked the agency's purchasing admin to finish setup. */
export interface Invite {
  id: string;
  agency: string;
  email: string;
  request_id: string | null;
  created_at: string;
}

/** A solicitation sent somewhere other than RFP Lite: Sovra's full RFP tool or the agency's own. */
export interface RfpHandoff {
  id: string;
  agency: string;
  request_id: string;
  tool: "sovra_rfp" | "euna" | "opengov" | "bonfire";
  title: string;
  created_at: string;
}

/** One outbound click to a contract page, logged by the /go redirect. */
export interface ClickEvent {
  id: string;
  contract_id: string;
  coop_id: string | null;
  listing_id: string | null;
  request_id: string | null;
  buyer_name: string | null;
  url: string;
  created_at: string;
}

export interface ContractDocument {
  id: string;
  filename: string;
  mime_type: string;
  file_hash: string;
  uploaded_by_role: Role;
  uploaded_at: string;
  page_count: number;
  parse_status: "pending" | "parsed" | "failed";
  parse_summary: { items_found: number; items_accepted: number; items_unresolved: number };
}

export interface TierPrice {
  min_qty: number;
  unit_price: number;
}

export interface ExtractedItem {
  id: string;
  document_id: string;
  row_index: number;
  sku: string | null;
  description: string;
  unit: string;
  unit_price: number | null;
  tier_pricing: TierPrice[] | null;
  category: Category;
  confidence: number;
  source_excerpt: string;
  source_page: number | null;
  source_file: string;
  status: "pending" | "accepted" | "rejected" | "unresolved" | "do_not_list";
  listing_id: string | null;
  /** Parser notes shown to the reviewer, e.g. why confidence is low. */
  flags: string[];
  /** Existing Agora listing this row appears to duplicate. */
  duplicate_of_listing_id?: string | null;
  /** Earlier row in the same upload this row duplicates. */
  duplicate_of_row?: number | null;
  replace_existing?: boolean;
}

export interface ContractHeader {
  supplier_name: string;
  contract_number: string;
  owner: string;
  source: ContractSource;
  title: string;
  start: string;
  end: string;
  piggyback_clause_present: boolean;
  piggyback_clause_text: string;
  payment_terms: string;
  delivery_terms: string;
}

export interface Listing {
  id: string;
  contract_id: string | null;
  supplier_id: string;
  source: Source;
  sku: string;
  title: string;
  category: Category;
  unit_price: number;
  unit: string;
  lead_time_days: number;
  extracted_item_id: string | null;
  marketplace_ids: string[];
  /** Short spec line shown under the title. */
  detail?: string;
  /** Extra words search should match, e.g. a catalog's category path. */
  keywords?: string;
  /** Where the product sits in the vendor's catalog, shown under its name. */
  path?: string;
  /** Listings sharing a family are tiers of one product, shown as one card. */
  family?: string;
  /** This tier's label within its family, e.g. "50k - 150k" or "Developer". */
  variant?: string;
  /** Population band the price applies to, if any. */
  band?: { min: number; max: number | null; label: string } | null;
}

export interface QuoteRequest {
  id: string;
  listing_id: string;
  contract_id: string;
  buyer: Buyer;
  quantity: number;
  note: string;
  created_at: string;
}

export interface ParsedRequest {
  category: Category | null;
  item: string;
  quantity: number;
  deadline: string | null;
  department: string;
  est_total: number;
}

export interface Request {
  id: string;
  raw_text: string;
  parsed: ParsedRequest;
  parse_mode: "llm" | "offline";
  preference_answer: "yes" | "no" | "always_ask" | null;
  created_at: string;
  outcome: "ordered" | "solicitation" | "abandoned" | null;
}

export interface Order {
  id: string;
  request_id: string | null;
  listing_id: string;
  quantity: number;
  total: number;
  payment: "pcard" | "po";
  status: "placed" | "pending_approval" | "approved";
  department: string;
  created_at: string;
}

export interface Solicitation {
  id: string;
  title: string;
  scope: string;
  quantity: string;
  est_budget: number;
  criteria: string[];
  piggybackable: boolean;
  status: "draft" | "open" | "awarded" | "closed";
  category: Category;
  awarded_supplier_id: string | null;
  awarded_listing_id: string | null;
  awarded_price?: number;
  awarded_unit?: string;
  request_id?: string | null;
  published_at?: string;
  based_on_id?: string | null;
}

export interface PeerPurchase {
  id: string;
  agency_name: string;
  distance_miles: number;
  listing_title: string;
  category: Category;
  unit_price: number;
  supplier_id: string;
  rating: number;
  piggybackable: boolean;
  date: string;
  note?: string;
}

export interface RevenueEvent {
  id: string;
  option: number;
  option_name: string;
  payer: Payer;
  amount: number;
  trigger: string;
  related_id: string | null;
  created_at: string;
}

export interface UnmetDemand {
  id: string;
  agency_name: string;
  search_text: string;
  category: Category;
  date: string;
}

export interface UpcomingSolicitation {
  id: string;
  agency_name: string;
  title: string;
  category: Category;
  due: string;
  est_value: number;
}

export interface ExpiringContract {
  id: string;
  agency_name: string;
  title: string;
  category: Category;
  incumbent: string;
  expires: string;
}

export interface AttentionItem {
  id: string;
  supplier_id: string;
  contract_id: string;
  document_id: string;
  extracted_item_id: string;
  description: string;
  reason: string;
  source_excerpt: string;
  created_at: string;
  resolved: boolean;
}

export interface PartnerApp {
  id: string;
  name: string;
  partner: string;
  blurb: string;
  started: boolean;
}

export interface Db {
  agency: Agency;
  marketplaces: CityMarketplace[];
  suppliers: Supplier[];
  reviews: Review[];
  contracts: Contract[];
  coops: Coop[];
  clicks: ClickEvent[];
  memberships: CoopMembership[];
  referrals: Referral[];
  impressions: Impression[];
  agency_settings: AgencySettings[];
  invites: Invite[];
  handoffs: RfpHandoff[];
  documents: ContractDocument[];
  extracted: ExtractedItem[];
  listings: Listing[];
  requests: Request[];
  orders: Order[];
  solicitations: Solicitation[];
  peers: PeerPurchase[];
  revenue: RevenueEvent[];
  unmet: UnmetDemand[];
  upcoming: UpcomingSolicitation[];
  expiring: ExpiringContract[];
  attention: AttentionItem[];
  quotes: QuoteRequest[];
  apps: PartnerApp[];
  recent: { title: string; supplier: string; date: string; qty: number; listing_id: string }[];
  session: {
    preference_answer: "yes" | "no" | "always_ask" | null;
    spend_dashboard_enabled: boolean;
    acting_supplier_id: string;
    /** Who is buying this session; null until asked at intake. */
    buyer: Buyer | null;
  };
  counters: Record<string, number>;
}
