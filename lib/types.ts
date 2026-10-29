// Data model for the storefront prototype. Mirrors section 5 of the build spec.

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

export interface Storefront {
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
  storefront_ids: string[];
  source_document_id: string | null;
  /** Whether option 2 (onboarding) has been billed for this contract. */
  onboarding_billed: boolean;
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
  /** Existing storefront listing this row appears to duplicate. */
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
  storefront_ids: string[];
  /** Short spec line shown under the title. */
  detail?: string;
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
  storefronts: Storefront[];
  suppliers: Supplier[];
  reviews: Review[];
  contracts: Contract[];
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
  apps: PartnerApp[];
  recent: { title: string; supplier: string; date: string; qty: number; listing_id: string }[];
  session: {
    preference_answer: "yes" | "no" | "always_ask" | null;
    spend_dashboard_enabled: boolean;
    acting_supplier_id: string;
  };
  counters: Record<string, number>;
}
