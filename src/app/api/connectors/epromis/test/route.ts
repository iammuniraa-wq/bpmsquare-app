import { NextResponse } from "next/server";
import { epromisGuard } from "@/lib/connectors/epromis/guard";
import { testEpromis } from "@/lib/connectors/epromis/server";

// POST -- a real, authenticated call to the configured ePROMIS address (its test address when one is set, otherwise
// the base address). -> { ok, line, failures: [{ label, fix }], verified }. A refused connection answers 400 with the same
// body plus `error`. The connection's status is updated either way. Never contains the credential.
export const maxDuration = 60;

export async function POST() {
  const g = await epromisGuard();
  if (!g.ok) return g.res;
  const { status, ...body } = await testEpromis(g.ctx.admin, g.ctx.tenantId);
  return NextResponse.json(body, { status: body.error ? status : 200 });
}
