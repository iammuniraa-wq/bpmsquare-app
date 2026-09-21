import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { isPlatformAdmin } from "@/lib/tenant";
import { WORKCENTERS } from "@/lib/workcenters";
import { NAV } from "@/lib/constants";
import { CURRENCIES } from "@/lib/currency";
import {
  normalisePlan, manualSteps, FEATURE_KEYS, PACKAGES,
  type TenantStudioPlan,
} from "@/lib/admin/tenantStudio";

/**
 * POST /api/admin/tenant-studio/plan — one turn of the Tenant Creation
 * Studio. Platform admin only.
 *
 * Takes what the operator typed and (from the second turn on) the plan as it
 * stands, and returns the whole plan again, revised. Conversational by
 * REPLACEMENT, not by patch: "actually make it workforce only" has to be
 * able to turn eleven modules off, and a diff-based protocol would have the
 * model emitting removals it can just as easily get wrong. The plan is small
 * and the operator sees it in full before anything is written, so sending it
 * whole each turn is both simpler and safer.
 *
 * Nothing here trusts the reply: normalisePlan() (lib/admin/tenantStudio.ts)
 * intersects every module, workcenter, nav href and currency with this
 * codebase's real catalogs and reports what it dropped. This route's job is
 * to give the model an accurate catalog to choose FROM -- the lists below are
 * generated from the same constants the app runs on, so they cannot drift
 * into describing modules that don't exist.
 */
export async function POST(request: NextRequest) {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    message?: string;
    plan?: TenantStudioPlan | null;
  } | null;
  const message = body?.message?.trim();
  if (!message) return NextResponse.json({ error: "Say what you want and I'll draft it." }, { status: 400 });
  if (message.length > 4000) return NextResponse.json({ error: "That's longer than this needs — describe the client in a paragraph or two." }, { status: 400 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY isn't set on this deployment, so the studio can't draft anything. Use /admin/tenants/new for now." },
      { status: 503 },
    );
  }

  const navList = NAV.flatMap((g) =>
    g.items.flatMap((i) => [
      `${i.href} (${g.group} → ${i.label})`,
      ...(i.children ?? []).map((c) => `${c.href} (${g.group} → ${i.label} → ${c.label})`),
    ])
  ).join("\n");

  const system = `You draft tenant provisioning plans for BPMSquare, a multi-tenant B2B SaaS. A platform admin describes a new client in plain words; you return ONE JSON object describing the tenant to create. You never execute anything — a human reviews your plan and presses Create.

Return ONLY the JSON object, no prose around it, matching exactly:
{
  "tenant": { "name": string, "slug": string, "custom_domain": string, "currency": string, "plan": string, "accent_color": string },
  "package": "wfm_only" | "full_crm" | "custom",
  "features": { "<module key>": boolean },
  "nav_hidden_hrefs": string[],
  "admin": { "email": string, "password": string },
  "roles": [ { "name": string, "description": string, "workcenters": [ { "key": string, "can_edit": boolean } ] } ],
  "users": [ { "email": string, "role": "admin" | "member", "business_role": string, "employee": { "first_name": string, "last_name": string, "wfm_role": "supervisor" | "employee", "designation": string } } ],
  "notes": string[]
}

RULES, all of which the server enforces anyway — following them just avoids warnings:
- slug: lowercase letters, digits and hyphens, 3-40 chars, derived from the name. It is permanent and is what the tenant is addressed by.
- custom_domain: REQUIRED. Default to "<slug>.bpmsquare.com" unless the admin names another. It is the address the client's users sign in at.
- currency: one of ${Object.keys(CURRENCIES).join(", ")}. Infer from the country if the admin names one; otherwise INR.
- features: use ONLY these module keys — ${FEATURE_KEYS.join(", ")}. Every key you omit is treated as off, so SCOPING IS BY OMISSION: list only what the client bought. A workforce-only client must NOT get the CRM modules.
- package "wfm_only" means ${PACKAGES.wfm_only.features.join(", ")}. "full_crm" means ${PACKAGES.full_crm.features.join(", ")} plus whatever else was sold. Use "custom" if it is neither.
- Workforce (wfm) always needs business_roles on as well.
- Never set next_experience, enterprise_theme or spectacular_theme. They are unreleased and are switched on by hand.
- nav_hidden_hrefs: only for a screen the client should not SEE even though its module is on. A module that wasn't bought is handled by leaving its feature off, not by hiding nav. Valid hrefs:
${navList}
- roles: Business Roles. A role grants access per workcenter, and a workcenter NOT listed is not accessible — grants are opt-in. Valid workcenter keys: ${WORKCENTERS.map((w) => w.key).join(", ")}. can_edit true means they can change things, false means read-only. Only create roles the admin asked for or that the description clearly implies (e.g. "two supervisors and 30 workers" implies a supervisor role and a worker role).
- admin.email: the PROVISIONING alias. If the admin gives an operator address like name@gmail.com, return name+<slug>@gmail.com — a plus-alias makes a genuinely new account, where a plain address links an existing one and silently keeps its old password. Generate a strong 12+ character password.
- users: only when the admin asks for sample or initial users. Give each a plausible email on the tenant's own domain unless told otherwise. Attach a business_role by NAME, matching one in your roles list. Add an "employee" object only when the workforce module is on and the person is a real worker (that is what creates their employee record and routes their corrections and leave).
- notes: one short line per real assumption you made, especially anything you guessed. Do not narrate the obvious.

When the admin sends a revision, return the WHOLE plan again with the change applied, keeping everything they did not ask you to change.`;

  const userTurn = body?.plan
    ? `The plan so far:\n${JSON.stringify(body.plan)}\n\nThe admin now says:\n${message}`
    : message;

  let parsed: unknown;
  try {
    const anthropic = new Anthropic();
    const res = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: userTurn }],
    });
    const text = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    // Models bracket JSON with a fence often enough that failing on it would
    // be a worse experience than tolerating it.
    const json = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = json.indexOf("{");
    const end = json.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("no JSON object in the reply");
    parsed = JSON.parse(json.slice(start, end + 1));
  } catch (e) {
    console.error("[tenant-studio] draft failed", e);
    return NextResponse.json({ error: "Couldn't draft that. Try describing the client again, or use /admin/tenants/new." }, { status: 502 });
  }

  const { plan, warnings } = normalisePlan(parsed);
  return NextResponse.json({ plan, warnings, manual_steps: manualSteps(plan) });
}
