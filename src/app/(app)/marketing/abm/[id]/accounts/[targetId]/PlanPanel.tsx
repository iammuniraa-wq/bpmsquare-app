"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { useFeel } from "@/components/FeelProvider";
import { ABM_TIERS, TIER_LABEL, TIER_HINT, type AbmTier } from "@/lib/abm/types";

type User = { id: string; name: string };
type Deal = { id: string; ref: string | null; title: string; outcome: string };

/**
 * The plan for one company: tier, our owner, the next step (what, when, who),
 * the deal this program is pursuing, and a private note. Saved together; only
 * what changed is sent. The owner defaults from Coverage; choosing one here
 * is a per-program override and never touches the account itself.
 */
export default function PlanPanel({ targetId, accountId, initial, users, canEdit }: {
  targetId: string; accountId: string; users: User[]; canEdit: boolean;
  initial: { tier: AbmTier; ownerId: string | null; ownerSource: string; nextStep: string; nextStepDue: string; nextStepUserId: string | null; opportunityId: string | null; notes: string };
}) {
  const router = useRouter();
  const { toast } = useFeel();
  const [v, setV] = useState(initial);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/abm/lookup?kind=deals&account_id=${accountId}`).then((r) => (r.ok ? r.json() : { items: [] })).then((j: { items: Deal[] }) => { if (live) setDeals(j.items ?? []); }).catch(() => {});
    return () => { live = false; };
  }, [accountId]);

  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  async function save() {
    const body: Record<string, unknown> = {};
    if (v.tier !== initial.tier) body.tier = v.tier;
    if (v.ownerId !== initial.ownerId) body.owner_user_id = v.ownerId;
    if (v.nextStep !== initial.nextStep) body.next_step = v.nextStep;
    if (v.nextStepDue !== initial.nextStepDue) body.next_step_due = v.nextStepDue || null;
    if (v.nextStepUserId !== initial.nextStepUserId) body.next_step_user_id = v.nextStepUserId;
    if (v.opportunityId !== initial.opportunityId) body.opportunity_id = v.opportunityId;
    if (v.notes !== initial.notes) body.notes = v.notes;
    setBusy(true);
    const res = await fetch(`/api/abm/targets/${targetId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { toast({ text: j.error ?? "Could not save the plan", tone: "error" }); return; }
    toast({ text: "Plan saved", tone: "success" });
    router.refresh();
  }

  async function check() {
    setBusy(true);
    const res = await fetch(`/api/abm/targets/${targetId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ check_progress: true }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { toast({ text: j.error ?? "Could not check progress", tone: "error" }); return; }
    toast({ text: j.rules_changed ? "Progress moved forward" : "Nothing new has happened", tone: "success" });
    router.refresh();
  }

  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((cur) => ({ ...cur, [k]: val }));
  const dis = !canEdit;

  return (
    <>
      <Card title="Next step" padding={16}>
        <Field label="What happens next"><Input value={v.nextStep} disabled={dis} onChange={(e) => set("nextStep", e.target.value)} placeholder="e.g. Call the decision maker about the site visit" maxLength={300} /></Field>
        <div className="fg2">
          <Field label="Due on"><Input type="date" value={v.nextStepDue} disabled={dis} onChange={(e) => set("nextStepDue", e.target.value)} /></Field>
          <Field label="Who does it">
            <Select value={v.nextStepUserId ?? ""} disabled={dis} onChange={(e) => set("nextStepUserId", e.target.value || null)}>
              <option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
      <Card title="Who and how" padding={16}>
        <div className="fg2">
          <Field label="Tier" hint={TIER_HINT[v.tier]}>
            <Select value={v.tier} disabled={dis} onChange={(e) => set("tier", e.target.value as AbmTier)}>{ABM_TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}</Select>
          </Field>
          <Field label="Owner for this program" hint={v.ownerId === initial.ownerId && initial.ownerSource === "coverage" ? "Set from Coverage. Change it to override for this program only." : initial.ownerSource === "manual" ? "Chosen by hand for this program." : "From the program owner: no Coverage rule matched this company."}>
            <Select value={v.ownerId ?? ""} disabled={dis} onChange={(e) => set("ownerId", e.target.value || null)}>
              <option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Deal this program is pursuing" hint="Linking a deal moves the company to Deal open, and to Won or Lost when the deal closes.">
          <Select value={v.opportunityId ?? ""} disabled={dis} onChange={(e) => set("opportunityId", e.target.value || null)}>
            <option value="">No deal linked</option>
            {deals.map((d) => <option key={d.id} value={d.id}>{d.ref ? `${d.ref} · ` : ""}{d.title} ({d.outcome})</option>)}
          </Select>
        </Field>
        <Field label="Private note" hint="Only people in your workspace see this. It never goes out through the API." style={{ marginBottom: 0 }}>
          <Textarea value={v.notes} disabled={dis} rows={3} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </Card>
      {canEdit && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>Save plan</Button>
          <Button onClick={check} disabled={busy} title="Looks at quotes, emails and deals and moves this company forward by the rules">Check progress</Button>
          {dirty && <span style={{ fontSize: 12, color: c.hint }}>Unsaved changes</span>}
        </div>
      )}
    </>
  );
}
