import { NextResponse } from "next/server";
import { guard } from "../../../_guard";
import { templates } from "@/lib/connections/endpointOps";

// The optional starting lists (Dynamics 365, SAP S/4HANA), read from the presets those connectors ship with. Nothing is applied by itself.
export async function GET(_req?: Request) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = templates();
  return NextResponse.json(o.body, { status: o.status });
}
