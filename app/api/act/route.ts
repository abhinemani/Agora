// Single dispatch route for demo actions: POST { action, ...args }.

import { NextResponse } from "next/server";
import { withSession } from "@/lib/session";
import * as A from "@/lib/actions";
import { currentScope } from "@/lib/db";
import { needsAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

type Handler = (body: any) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
  createRequest: (b) => A.createRequest(b.text),
  setPreference: (b) => A.setPreference(b.requestId, b.answer),
  setBuyer: (b) => A.setBuyer(b.buyer),
  clearBuyer: () => A.clearBuyer(),
  requestQuote: (b) => A.requestQuote(b),
  getResults: (b) => A.getResults(b.requestId),
  confirmItems: (b) => A.confirmItems(b),
  editItems: (b) => A.editItems(b.requestId),
  shopperBrief: (b) => A.shopperBrief(b.requestId),
  askShopper: (b) => A.askShopper(b),
  draftPaperwork: (b) => A.draftPaperwork(b),
  contractsToAsk: () => A.contractsToAsk(),
  askContract: (b) => A.askContract(b),
  dive: (b) => A.dive(b),
  diveCompare: (b) => A.diveCompare(b),
  placeOrder: (b) => A.placeOrder(b),
  approveOrder: (b) => A.approveOrder(b.orderId),
  advanceOrder: (b) => A.advanceOrder(b.orderId),
  addToCart: (b) => A.addToCart(b),
  updateCartLine: (b) => A.updateCartLine(b),
  handoffCart: (b) => A.handoffCart(b),
  submitCart: () => A.submitCart(),
  approveCart: (b) => A.approveCart(b.cartId),
  rejectCart: (b) => A.rejectCart(b),
  reviseCart: (b) => A.reviseCart(b.cartId),
  draftSolicitation: (b) => A.draftSolicitation(b.requestId),
  publishSolicitation: (b) => A.publishSolicitation(b.draft),
  startRenewal: (b) => A.startRenewal(b.contractId),
  listAward: (b) => A.listAward(b.solicitationId),
  publishContract: (b) => A.publishContract(b),
  resolveAttention: (b) => A.resolveAttention(b.id, Number(b.price)),
  setTier: (b) => A.setTier(b.tier),
  setSponsored: (b) => A.setSponsored(Boolean(b.on)),
  addMarketplace: (b) => A.addMarketplace(b.marketplaceId),
  startApp: (b) => A.startApp(b.appId),
  respondToReview: (b) => A.respondToReview(b.reviewId, b.text),
  setMembership: (b) => A.setMembership(b),
  addCoop: (b) => A.addCoop(b),
  claimStorefront: (b) => A.claimStorefront(b),
  adoptCatalogSupplier: (b) => A.adoptCatalogSupplier(b.supplierId),
  approveClaim: (b) => A.approveClaim(b.supplierId),
  actAsSupplier: (b) => A.actAsSupplier(b.supplierId),
  setSupplierPlan: (b) => A.setSupplierPlan(b),
  updateStorefront: (b) => A.updateStorefront(b),
  addPlacement: (b) => A.addPlacement(b),
  removePlacement: (b) => A.removePlacement(b.placementId),
  payListingFee: (b) => A.payListingFee(b.supplierId),
  setPlan: (b) => A.setPlan(b.plan),
  setAdFree: (b) => A.setAdFree(Boolean(b.on)),
  inviteAdmin: (b) => A.inviteAdmin(b),
  handoffRfp: (b) => A.handoffRfp(b),
  askToJoin: (b) => A.askToJoin(b),
  setCoopBuyInAgora: (b) => A.setCoopBuyInAgora(b.coopId, Boolean(b.on)),
  reset: () => {
    A.reset();
    // A reset also forgets this visitor's agency, so the demo starts clean.
    A.clearBuyer();
    return { ok: true };
  },
};

// What anyone can do without an account: search, set an agency, and use the shopper's tools.
const OPEN = new Set(["createRequest", "setPreference", "setBuyer", "clearBuyer", "getResults", "confirmItems", "editItems", "shopperBrief", "askShopper", "dive", "diveCompare", "contractsToAsk", "askContract"]);
// Everything else needs a signed-in person. The phrase finishes "Sign in or create a free account to ...".
const WHY: [RegExp, string][] = [
  [/cart/i, "use the cart"],
  [/order/i, "place and track orders"],
  [/quote/i, "request a quote"],
  [/paperwork/i, "draft paperwork"],
  [/join|invite|membership|coop/i, "work with purchasing on co-ops"],
  [/solicitation|award|renewal|rfp/i, "build a solicitation"],
  [/reset/i, "reset the demo"],
];

export const POST = withSession(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const handler = handlers[body?.action];
  if (!handler) return NextResponse.json({ error: `Unknown action: ${body?.action}` }, { status: 400 });
  if (!OPEN.has(body.action) && !currentScope()?.user) return needsAccount(WHY.find(([re]) => re.test(body.action))?.[1] ?? "do that");
  try {
    return NextResponse.json({ result: await handler(body) });
  } catch (err) {
    const status = err instanceof A.ActionError ? 400 : 500;
    if (status === 500) console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
});
