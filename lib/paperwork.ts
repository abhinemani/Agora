// Paperwork drafted from the purchase file: the justification memo, a quote
// request under a co-op contract, and the note asking purchasing to get the
// agency onto a co-op. The templates here are rule-based and complete on their
// own, and safe to import in the browser. With an API key the model tidies the
// wording (lib/paperwork-ai.ts), and its version is kept only if every figure
// and contract number still matches.

import type { Results } from "./assistant";
import { usd, type Plan } from "./shopper";

export type PaperworkKind = "memo" | "quote_request" | "join_note";

export interface Paperwork {
  kind: PaperworkKind;
  title: string;
  text: string;
  written_by: "template" | "llm";
  /** The model call that worded it, so a thumbs up or down can be recorded against it. */
  log_id?: string;
}

export const PAPERWORK_LABEL: Record<PaperworkKind, string> = {
  memo: "Justification memo",
  quote_request: "Quote request to the supplier",
  join_note: "Note to purchasing",
};

/** Which drafts make sense for this plan. */
export function paperworkKinds(plan: Plan): PaperworkKind[] {
  const kinds: PaperworkKind[] = ["memo"];
  if (plan.routes.some((r) => r.kind === "member")) kinds.push("quote_request");
  if (plan.routes.some((r) => r.kind === "join")) kinds.push("join_note");
  return kinds;
}

const today = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

/** The signed-in person drafting the document. Their name fills the "From" line; what Agora doesn't know stays a [bracketed] blank. */
export interface PaperworkAuthor {
  name: string;
  department?: string | null;
}

export function paperworkTemplate(results: Results, plan: Plan, kind: PaperworkKind, author?: PaperworkAuthor | null): Paperwork {
  const draft = blankTemplate(results, plan, kind);
  const name = author?.name?.trim();
  if (!name) return draft;
  const dept = author?.department?.trim();
  return { ...draft, text: draft.text.replaceAll("[Your name, department]", dept ? `${name}, ${dept}` : `${name}, [department]`).replaceAll("[Your name]", name) };
}

function blankTemplate(results: Results, plan: Plan, kind: PaperworkKind): Paperwork {
  const agency = results.buyer ? `${results.buyer.name}, ${results.buyer.state}` : "[Agency]";
  const need = results.request.raw_text;
  const itemLines = plan.lines.length
    ? plan.lines.map((l) => `  - ${l.quantity} × ${l.title} (${l.sku}) at ${usd(l.unit_price)} / ${l.unit}: ${usd(l.amount)}`)
    : [`  - ${plan.file.items}`];
  const sources = plan.refs.map((r) => `  Ref ${r.n}: ${r.label}`);
  const member = plan.routes.find((r) => r.kind === "member");
  const join = plan.routes.find((r) => r.kind === "join");

  if (kind === "quote_request") {
    const h = member!.hits[0];
    return {
      kind,
      written_by: "template",
      title: `Quote request under ${h.coop} ${h.contract_number}`,
      text: [
        `To: ${h.supplier}`,
        `From: [Your name], ${agency}`,
        `Date: ${today()}`,
        `Subject: Quote request under ${h.coop} contract ${h.contract_number}`,
        "",
        `${results.buyer?.name ?? "Our agency"} would like a quote under ${h.coop} contract ${h.contract_number} (${h.title}).`,
        "",
        "What we need:",
        ...(plan.lines.length ? plan.lines.map((l) => `  - ${l.quantity} × ${l.title}, or your equivalent`) : [`  - ${plan.file.items}`]),
        `  Our request, in our own words: "${need}"`,
        "",
        "Please include:",
        "  - The unit price for each item and how it is calculated under the contract (the list price and the contract discount)",
        "  - Delivery cost and lead time",
        "  - How long the quote is valid",
        "  - Confirmation that our agency may order under this contract, and anything you need from us to do so",
        "",
        "Deliver to: [Address]",
        "Needed by: " + (results.request.parsed.deadline ?? "[Date]"),
        "",
        "Thank you,",
        "[Your name, title, phone, email]",
      ].join("\n"),
    };
  }

  if (kind === "join_note") {
    const h = join!.hits[0];
    const better = results.coops.better?.hit.contract_id === h.contract_id;
    return {
      kind,
      written_by: "template",
      title: `Request to use ${h.coop} ${h.contract_number}`,
      text: [
        "To: Purchasing",
        `From: [Your name, department]`,
        `Date: ${today()}`,
        `Subject: Can we get onto ${h.coop} for this purchase?`,
        "",
        `I'm looking to buy: "${need}".`,
        "",
        `Agora shows a contract that covers it on a co-op ${results.buyer?.name ?? "we"} ${results.buyer ? "isn't" : "aren't"} on yet:`,
        `  ${h.coop} ${h.contract_number}, ${h.supplier}: ${h.title}`,
        `  Who can use it: ${h.reason}`,
        ...(better ? ["  Agora rates it a better fit for this request than anything on our current co-ops. That compares scope, not price."] : []),
        ...(h.verification === "research_lead" ? ["  Agora marks this contract a research lead: its current term isn't confirmed."] : []),
        "",
        member ? `What we can use today instead: ${member.hits.map((x) => `${x.coop} ${x.contract_number} (${x.supplier})`).join("; ")}.` : "Nothing on our current co-ops covers this, as far as Agora shows.",
        plan.total !== null ? `For reference, the priced option open to us today comes to ${usd(plan.total)}.` : "Agora holds no prices for these contracts, so I can't say yet which would cost less.",
        "",
        `Could you tell me whether we can use ${h.coop}, and what it would take?`,
        "",
        "Thanks,",
        "[Your name]",
      ].join("\n"),
    };
  }

  return {
    kind,
    written_by: "template",
    title: "Purchase justification memo",
    text: [
      "MEMORANDUM",
      "",
      "To: [Approver]",
      "From: [Your name, department]",
      `Date: ${today()}`,
      `Subject: Justification for purchase: ${results.request.parsed.item}`,
      "",
      "1. What is needed",
      `  ${agency} needs: "${need}".`,
      ...itemLines,
      ...(plan.total !== null ? [`  Total: ${usd(plan.total)}`] : ["  Total: to be set by quote"]),
      "",
      "2. Recommended route",
      `  ${plan.file.route}.`,
      `  ${plan.file.why}`,
      `  Still needed before ordering: ${plan.file.needed}`,
      "",
      "3. Options considered",
      ...plan.routes.map((r) => `  - ${r.recommended ? "(Recommended) " : ""}${r.title}. ${r.body}${r.refs.length ? ` [Ref ${r.refs.join(", ")}]` : ""}`),
      "",
      "4. What is not known",
      ...(plan.unknowns.length ? plan.unknowns.map((u) => `  - ${u}`) : ["  - Nothing flagged."]),
      "",
      "5. Sources",
      ...sources,
      "",
      "Eligibility and prices above come from Agora's contract records as of the date of this memo. Confirm the contract's current term and any local requirements before ordering.",
    ].join("\n"),
  };
}
