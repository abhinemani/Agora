// Single dispatch route for demo actions: POST { action, ...args }.

import { NextResponse } from "next/server";
import * as A from "@/lib/actions";

export const dynamic = "force-dynamic";

type Handler = (body: any) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
  createRequest: (b) => A.createRequest(b.text),
  setPreference: (b) => A.setPreference(b.requestId, b.answer),
  getResults: (b) => A.getResults(b.requestId),
  placeOrder: (b) => A.placeOrder(b),
  approveOrder: (b) => A.approveOrder(b.orderId),
  draftSolicitation: (b) => A.draftSolicitation(b.requestId),
  publishSolicitation: (b) => A.publishSolicitation(b.draft),
  listAward: (b) => A.listAward(b.solicitationId),
  publishContract: (b) => A.publishContract(b),
  resolveAttention: (b) => A.resolveAttention(b.id, Number(b.price)),
  setTier: (b) => A.setTier(b.tier),
  setSponsored: (b) => A.setSponsored(Boolean(b.on)),
  addStorefront: (b) => A.addStorefront(b.storefrontId),
  startApp: (b) => A.startApp(b.appId),
  respondToReview: (b) => A.respondToReview(b.reviewId, b.text),
  reset: () => {
    A.reset();
    return { ok: true };
  },
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const handler = handlers[body?.action];
  if (!handler) return NextResponse.json({ error: `Unknown action: ${body?.action}` }, { status: 400 });
  try {
    return NextResponse.json({ result: await handler(body) });
  } catch (err) {
    const status = err instanceof A.ActionError ? 400 : 500;
    if (status === 500) console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
