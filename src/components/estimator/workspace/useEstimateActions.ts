"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { useFeel } from "@/components/FeelProvider";
import { toParams } from "@/components/estimator/InputsForm";
import type { InputIssue } from "@/components/estimator/InputsForm";
import type { EstimateDraft } from "./useEstimateDraft";

type Busy = null | "draft" | "save" | "quote" | "recalc";
type Json = Record<string, unknown>;

const JSON_HEADERS = { "Content-Type": "application/json" };
const CONFIRM_QUOTE = {
  title: "Create the quote?",
  body: "The estimate is locked once it has a quote: its details and margin can no longer change. The customer sees one price per section, never your unit costs.",
};

/**
 * What the buttons on the working page do. Nothing is saved until one of them is
 * pressed. Create quote saves the estimate first when it is still new (or has
 * unsaved changes), then makes the Standard Quote and opens the saved estimate,
 * which shows the customer's view and the link to the quote.
 */
export function useEstimateActions(a: { draft: EstimateDraft; savedId?: string; savedAccountId?: string; savedContactId?: string; dirty: boolean }) {
  const { draft, savedId, savedAccountId = "", savedContactId = "", dirty } = a;
  const router = useRouter();
  const { toast, confirm } = useFeel();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<InputIssue[]>([]);
  const [needAccount, setNeedAccount] = useState(false);

  const inputs = draft.template?.inputs ?? [];
  const params = () => toParams(inputs, draft.values);
  const margin = () => (draft.margin.trim() === "" ? 0 : Number(draft.margin));

  function fail(json: Json, fallback: string) {
    setError(typeof json.error === "string" ? json.error : fallback);
    if (Array.isArray(json.issues)) setIssues(json.issues as InputIssue[]);
  }

  async function create(accountId: string): Promise<{ id: string; ref: string | null } | null> {
    const res = await fetch("/api/estimates", {
      method: "POST", headers: JSON_HEADERS,
      body: JSON.stringify({
        name: draft.customer.trim(), template_id: draft.template?.id, account_id: accountId || null, contact_id: draft.contactId || null,
        params: params(), margin_pct: margin(), notes: draft.notes.trim() || null, custom_data: draft.customData,
        // From the shared Inbox: the server links the email to the estimate once it exists (and ignores it if it may not).
        source_email_id: draft.sourceEmailId,
        // From a tender deal's Estimates tab: the server checks the deal belongs to this workspace and attaches the estimate to it.
        ...(draft.opportunityId ? { opportunity_id: draft.opportunityId } : {}),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) { fail(json, "Could not save the estimate."); return null; }
    return { id: json.id as string, ref: (json.ref as string) ?? null };
  }

  async function patch(id: string, body: Json): Promise<boolean> {
    const res = await fetch(`/api/estimates/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) { fail(json, "Could not save the changes."); return false; }
    return true;
  }

  function begin(kind: Exclude<Busy, null>) { setBusy(kind); setError(""); setIssues([]); }

  async function saveDraft() {
    if (!draft.customer.trim()) { setError("Add the customer or project name first, so the estimate can be found later."); return; }
    begin("draft");
    try {
      const made = await create(draft.accountId);
      if (made) {
        toast({ text: made.ref ? `Draft ${made.ref} saved` : "Draft saved", tone: "success" });
        router.push(ROUTES.estimate(made.id));
      }
    } catch { setError("Network error. Try again."); } finally { setBusy(null); }
  }

  async function saveChanges(): Promise<boolean> {
    if (!savedId) return false;
    begin("save");
    try {
      const ok = await patch(savedId, { params: params(), margin_pct: margin() });
      if (ok) { toast({ text: "Changes saved", tone: "success" }); router.refresh(); }
      return ok;
    } catch { setError("Network error. Try again."); return false; } finally { setBusy(null); }
  }

  async function recalculate() {
    if (!savedId) return;
    begin("recalc");
    try {
      const res = await fetch(`/api/estimates/${savedId}/calculate`, { method: "POST", headers: JSON_HEADERS, body: "{}" });
      const json = (await res.json().catch(() => ({}))) as Json;
      if (!res.ok) fail(json, "Could not recalculate.");
      else { toast({ text: "Recalculated with the current template", tone: "success" }); router.refresh(); }
    } catch { setError("Network error. Try again."); } finally { setBusy(null); }
  }

  /** `accountId` is passed by the account prompt, which has just chosen or created one. */
  async function createQuote(accountId: string = draft.accountId) {
    if (!savedId && !draft.customer.trim()) { setError("Add the customer or project name first."); return; }
    if (!accountId) { setNeedAccount(true); setError(""); return; }
    setNeedAccount(false);
    if (!(await confirm(CONFIRM_QUOTE))) return;
    begin("quote");
    let id = savedId ?? null;
    try {
      if (!id) {
        const made = await create(accountId);
        if (!made) return;
        id = made.id;
      } else {
        // Only what changed is sent: an account change re-prices the estimate.
        const body: Json = {};
        if (accountId !== savedAccountId) body.account_id = accountId;
        if (draft.contactId !== savedContactId) body.contact_id = draft.contactId || null;
        if (dirty) { body.params = params(); body.margin_pct = margin(); }
        if (Object.keys(body).length > 0 && !(await patch(id, body))) return;
      }
      const res = await fetch(`/api/estimates/${id}/quote`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as Json;
      if (res.ok || (res.status === 409 && json.quoteId)) {
        toast({ text: res.ok ? `Quote ${json.ref} created` : "This estimate already has a quote", tone: res.ok ? "success" : "info" });
        if (savedId) router.refresh(); else router.push(ROUTES.estimate(id));
        return;
      }
      fail(json, "Could not create the quote.");
      if (!savedId) {
        toast({ text: "The estimate was saved as a draft, but the quote could not be made.", tone: "error" });
        router.push(ROUTES.estimate(id));
      }
    } catch { setError("Network error. Try again."); } finally { setBusy(null); }
  }

  return { busy, error, issues, needAccount, setNeedAccount, saveDraft, saveChanges, recalculate, createQuote };
}
