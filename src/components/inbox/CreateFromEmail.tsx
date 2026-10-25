"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import { ROUTES } from "@/lib/constants";
import { CREATE_LABEL, type CreateType } from "@/lib/inbox/types";
import { emailAsBrief, summarise } from "@/lib/inbox/rules";
import { INBOX_TIPS } from "@/lib/inbox/tips";
import s from "./inbox.module.css";

type Option = { type: CreateType; available: boolean; reason: string | null };
type Match = { contactId: string; contactName: string | null; accountId: string | null; accountName: string | null } | null;
type Hit = { id: string; title: string };

const HINT: Record<CreateType, string> = {
  quote: "A draft quote for this customer",
  project: "A project to cost hours against",
  case: "A service case to work on",
  lead: "A lead to follow up",
  estimate: "Start an estimate from what they wrote",
  deal: "A tender deal with its closing date and bid decision",
};

type EmailBits = { id: string; subject: string; from_name: string | null; from_address: string | null; body_text: string | null };

/**
 * "Create from this email". The channel's favourite is listed first. Quote, Project, Case, Lead and Deal (tender edition only) open a short panel
 * (the account is matched from the sender, or searched, or created from the sender) and the record is made by its own
 * create route on the server; Estimate opens the estimate workspace with the email already in its intake card. Nothing
 * here treats the email's words as instructions: they are shown, summarised and handed on as text.
 */
export default function CreateFromEmail({ email, options, match, suggestedAccount, estimatesAvailable, disabled }: {
  email: EmailBits;
  options: Option[];
  match: Match;
  suggestedAccount: string;
  estimatesAvailable: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const { toast } = useFeel();
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<Exclude<CreateType, "estimate"> | null>(null);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [menu]);

  async function startEstimate() {
    setMenu(false);
    setBusy(true);
    const go = (q: string) => router.push(`${ROUTES.estimateNew}?from_email=${email.id}${q}`);
    try {
      const res = await fetch("/api/estimates/ai/pick", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: emailAsBrief(email) }),
      });
      if (res.status === 403) { toast({ text: "Your role cannot create estimates.", tone: "error" }); return; }
      // The merged pick endpoint answers { configured, template_id, name, confidence, level, alternatives, not_sure, reason }.
      const json = (await res.json().catch(() => ({}))) as { configured?: boolean; template_id?: string | null; not_sure?: boolean };
      if (res.ok && json.configured !== false && json.template_id && !json.not_sure) { go(`&template=${encodeURIComponent(json.template_id)}`); return; }
      toast({ text: res.ok && json.configured !== false ? "Not sure which template fits. Choose one on the next screen." : "Template suggestion is not available. Choose the template on the next screen.", tone: "info" });
      go("");
    } catch {
      toast({ text: "Template suggestion is not available. Choose the template on the next screen.", tone: "info" });
      go("");
    } finally {
      setBusy(false);
    }
  }

  function choose(o: Option) {
    if (!o.available) return;
    if (o.type === "estimate") { void startEstimate(); return; }
    setMenu(false);
    setPanel(o.type);
  }

  return (
    <div className={s.menu} ref={wrap}>
      <Button
        variant="primary" disabled={disabled || busy} loading={busy} aria-haspopup="menu" aria-expanded={menu} data-guide="inbox.create"
        onClick={() => setMenu((v) => !v)}
      >
        Create from this email ▾
      </Button>
      {menu && (
        <div className={s.menuList} role="menu" aria-label="Create from this email">
          {options.map((o, i) => (
            <button
              key={o.type} type="button" role="menuitem" className={`${s.menuItem} ${i === 0 && o.available ? s.menuFirst : ""}`}
              disabled={!o.available || (o.type === "estimate" && !estimatesAvailable)} onClick={() => choose(o)}
            >
              <span>{CREATE_LABEL[o.type]}{i === 0 && o.available ? " · suggested" : ""}</span>
              <span className={s.menuHint}>{o.available && (o.type !== "estimate" || estimatesAvailable) ? HINT[o.type] : o.reason ?? "Estimates not available"}</span>
            </button>
          ))}
          <div style={{ padding: "4px 10px" }}><InfoTip label="Create from this email">{INBOX_TIPS.create}</InfoTip></div>
        </div>
      )}
      {panel && (
        <CreatePanel type={panel} email={email} match={match} suggestedAccount={suggestedAccount} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}

export function CreatePanel({ type, email, match, suggestedAccount, onClose }: {
  type: Exclude<CreateType, "estimate">; email: EmailBits; match: Match; suggestedAccount: string; onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useFeel();
  const needsAccount = type !== "project";
  type Mode = "match" | "search" | "new";
  const [mode, setMode] = useState<Mode>(match?.accountId ? "match" : needsAccount ? "new" : "search");
  const [accountId, setAccountId] = useState<string>(match?.accountId ?? "");
  const [accountLabel, setAccountLabel] = useState<string>(match?.accountName ?? "");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [newName, setNewName] = useState(suggestedAccount);
  const [title, setTitle] = useState((email.subject || "Customer enquiry").slice(0, 200));
  const [caseType, setCaseType] = useState<"adhoc" | "direct" | "amc">("adhoc");
  const [complaint, setComplaint] = useState(summarise(email.body_text, 600) || email.subject);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "search" || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?type=account&q=${encodeURIComponent(q.trim())}`);
        const j = (await r.json()) as { results?: { id: string; title: string }[] };
        setHits((j.results ?? []).slice(0, 8).map((x) => ({ id: x.id, title: x.title })));
      } catch { setHits([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, mode]);

  const label = CREATE_LABEL[type];

  async function create() {
    setError("");
    if (needsAccount && mode === "search" && !accountId) { setError("Choose an account, or create one from the sender."); return; }
    if (mode === "new" && !newName.trim()) { setError("Give the new account a name."); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { type, title: title.trim() };
      if (type === "case") { body.case_type = caseType; body.complaint = complaint.trim(); }
      if (mode === "new") body.new_account = { name: newName.trim() };
      else if (accountId) { body.account_id = accountId; if (match?.accountId === accountId && match.contactId) body.contact_id = match.contactId; }
      const res = await fetch(`/api/inbox/emails/${email.id}/create`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { error?: string; href?: string; label?: string; copied?: number; total_files?: number };
      if (!res.ok) { setError(json.error ?? "Could not create it."); return; }
      const files = json.total_files ? ` ${json.copied ?? 0} of ${json.total_files} file${json.total_files === 1 ? "" : "s"} copied.` : "";
      toast({ text: `${label} ${json.label ?? ""} created.${files}`.replace("  ", " "), tone: "success" });
      router.push(json.href ?? ROUTES.inbox);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidePanel
      title={`Create ${label.toLowerCase()} from this email`}
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={create}>Create {label.toLowerCase()}</Button></>}
    >
      {error && <div role="alert" className={`${s.notice} ${s.noticeErr}`}>{error}</div>}

      {(type === "project" || type === "lead" || type === "deal") && (
        <Field label={type === "project" ? "Project name" : type === "deal" ? "Deal title" : "Lead title"}>
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      )}
      {type === "case" && (
        <>
          <Field label="Equipment or subject">
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Case type">
            <Select value={caseType} onChange={(e) => setCaseType(e.target.value as typeof caseType)}>
              <option value="adhoc">Adhoc</option><option value="direct">Direct</option><option value="amc">AMC (contract)</option>
            </Select>
          </Field>
          <Field label="What they reported">
            <Textarea rows={4} value={complaint} maxLength={2000} onChange={(e) => setComplaint(e.target.value)} />
          </Field>
        </>
      )}

      <div className={s.formGrid}>
        <div className="bpm-label-row"><span className="bpm-t-label">{needsAccount ? "Account" : "Account (optional)"}</span></div>
        <div className={s.choice} role="group" aria-label="Account">
          {match?.accountId && (
            <button type="button" className={`${s.choiceBtn} ${mode === "match" ? s.choiceOn : ""}`} onClick={() => { setMode("match"); setAccountId(match.accountId!); setAccountLabel(match.accountName ?? ""); }}>
              {match.accountName ?? "Matched account"}{match.contactName ? ` · ${match.contactName}` : ""}
            </button>
          )}
          <button type="button" className={`${s.choiceBtn} ${mode === "search" ? s.choiceOn : ""}`} onClick={() => { setMode("search"); if (match?.accountId && accountId === match.accountId) setAccountId(""); }}>
            Another account
          </button>
          {needsAccount && (
            <button type="button" className={`${s.choiceBtn} ${mode === "new" ? s.choiceOn : ""}`} onClick={() => setMode("new")}>
              New from the sender
            </button>
          )}
        </div>
        {mode === "search" && (
          <>
            <Input value={q} placeholder="Search accounts by name" onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
            {accountId && accountLabel && <div className={s.stubNote}>Chosen: {accountLabel}</div>}
            <div className={s.results}>
              {hits.map((h) => (
                <button key={h.id} type="button" className={`${s.choiceBtn} ${accountId === h.id ? s.choiceOn : ""}`} onClick={() => { setAccountId(h.id); setAccountLabel(h.title); }}>{h.title}</button>
              ))}
            </div>
          </>
        )}
        {mode === "new" && (
          <Field label="New account name">
            <Input value={newName} maxLength={200} onChange={(e) => setNewName(e.target.value)} />
          </Field>
        )}
      </div>
    </SidePanel>
  );
}
