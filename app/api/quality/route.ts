// How the model's output is faring: counts by task for everyone, and the
// recent calls worth a look (with what was asked and written) for signed-in people.

import { NextResponse } from "next/server";
import { quality } from "@/lib/ai-log";
import { currentScope, hasApiKey } from "@/lib/db";
import { withSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = withSession(async () => NextResponse.json({ result: { ...quality({ detail: Boolean(currentScope()?.user) }), llm: hasApiKey() } }), { readOnly: true });
