import "server-only";
import { NextRequest } from "next/server";
import type { Created, CreateInput, Creators } from "./convert";

// The default way each record is made: by calling the object's OWN create route in-process, in the same request, so the
// signed-in person's session decides access and every rule of the "New" form (required fields, foreign-id checks, master
// reference, change history, events) applies unchanged. Nothing is re-implemented here. Tests inject their own creators.

type Handler = (req: NextRequest) => Promise<Response>;

async function call(handler: Handler, path: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const req = new NextRequest(new URL(path, "http://internal.invalid"), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const res = await handler(req);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

const fail = (r: { status: number; json: Record<string, unknown> }, fallback: string): Created => ({
  ok: false, status: r.status >= 400 ? r.status : 500, error: typeof r.json.error === "string" ? r.json.error : fallback,
});

export const defaultCreators: Creators = {
  async quote(input: CreateInput) {
    if (!input.accountId) return { ok: false, error: "Choose the account this quote is for.", status: 422 };
    const { POST } = await import("@/app/api/standard-quotes/route");
    const r = await call(POST as Handler, "/api/standard-quotes", { account_id: input.accountId, contact_id: input.contactId ?? undefined, lines: [] });
    return r.status === 201 && typeof r.json.id === "string"
      ? { ok: true, id: r.json.id, label: typeof r.json.ref === "string" ? r.json.ref : "Quote" }
      : fail(r, "Could not create the quote.");
  },
  async case(input: CreateInput) {
    if (!input.accountId) return { ok: false, error: "Choose the account this case is for.", status: 422 };
    const { POST } = await import("@/app/api/cases/route");
    const r = await call(POST as Handler, "/api/cases", {
      account_id: input.accountId, type: input.caseType ?? "adhoc", equipment_label: input.title.slice(0, 200), complaint: (input.complaint ?? input.title).slice(0, 2000),
    });
    return r.status === 201 && typeof r.json.id === "string"
      ? { ok: true, id: r.json.id, label: typeof r.json.ref === "string" ? r.json.ref : "Case" }
      : fail(r, "Could not create the case.");
  },
  async lead(input: CreateInput) {
    if (!input.accountId) return { ok: false, error: "Choose the account this lead is for.", status: 422 };
    const { POST } = await import("@/app/api/leads/route");
    const r = await call(POST as Handler, "/api/leads", { account_id: input.accountId, title: input.title.slice(0, 200) });
    return r.status === 201 && typeof r.json.id === "string"
      ? { ok: true, id: r.json.id, label: input.title.slice(0, 200) }
      : fail(r, "Could not create the lead.");
  },
  async project(input: CreateInput) {
    const { POST } = await import("@/app/api/wfm/projects/route");
    const r = await call(POST as Handler, "/api/wfm/projects", { name: input.title.slice(0, 200), account_id: input.accountId ?? null });
    return r.status < 300 && typeof r.json.id === "string"
      ? { ok: true, id: r.json.id, label: (typeof r.json.ref === "string" && r.json.ref) || (typeof r.json.name === "string" ? r.json.name : "Project") }
      : fail(r, "Could not create the project.");
  },
};

/** A new account (and the sender as its contact) when the customer is not in the address book yet. */
export async function createAccountFromSender(args: { accountName: string; email: string | null; contactName: string | null }): Promise<
  { ok: true; accountId: string; contactId: string | null } | { ok: false; error: string; status: number }
> {
  const { POST: postAccount } = await import("@/app/api/accounts/route");
  const a = await call(postAccount as Handler, "/api/accounts", { name: args.accountName.slice(0, 200), type: "prospect", email: args.email ?? undefined });
  if (a.status !== 201 || typeof a.json.id !== "string") return fail(a, "Could not create the account.") as { ok: false; error: string; status: number };
  const accountId = a.json.id;
  let contactId: string | null = null;
  if (args.contactName) {
    const { POST: postContact } = await import("@/app/api/contacts/route");
    const c = await call(postContact as Handler, "/api/contacts", { account_id: accountId, name: args.contactName.slice(0, 200), email: args.email ?? undefined });
    if (c.status < 300 && typeof c.json.id === "string") contactId = c.json.id;
  }
  return { ok: true, accountId, contactId };
}
