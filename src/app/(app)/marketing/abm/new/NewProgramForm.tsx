"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { ABM_TIPS } from "@/lib/abm/tips";
import { ABM_TIERS, TIER_LABEL, TIER_HINT, GOAL_METRICS, GOAL_METRIC_LABEL, PROGRAM_KINDS, KIND_LABEL, REQUIRABLE_ROLES, ROLE_LABEL, DEFAULT_REQUIRED_ROLES, type AbmRole } from "@/lib/abm/types";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";

type Pick = { id: string; name: string };

export default function NewProgramForm({ members, groups, segments, currentUserId }: {
  members: { user_id: string; name: string | null; email: string | null }[];
  groups: Pick[];
  segments: Pick[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", kind: "new_business", goal: "", goal_metric: "deals_won", goal_target: "", starts_on: "", ends_on: "",
    owner_user_id: currentUserId, default_tier: "one_to_many",
  });
  const [roles, setRoles] = useState<AbmRole[]>(DEFAULT_REQUIRED_ROLES);
  const [source, setSource] = useState<{ kind: "none" | "group" | "segment"; id: string }>({ kind: "none", id: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Give the program a name"); return; }
    if (source.kind !== "none" && !source.id) { setError("Choose the list to start from, or pick “Start empty”"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/abm/programs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, goal_target: form.goal_target === "" ? null : Number(form.goal_target), starts_on: form.starts_on || null, ends_on: form.ends_on || null, required_roles: roles }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not create the program"); return; }
      if (source.kind !== "none") {
        const add = await fetch(`/api/abm/programs/${j.id}/targets`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(source.kind === "group" ? { target_group_id: source.id } : { segment_id: source.id }),
        });
        if (!add.ok) {
          const aj = await add.json().catch(() => ({}));
          setError(aj.error ?? "The program was created, but the list could not be added. Add accounts from the program page.");
          router.push(ROUTES.marketingAbmProgram(j.id));
          return;
        }
      }
      router.push(ROUTES.marketingAbmProgram(j.id));
    });
  }

  const toggleRole = (r: AbmRole) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  return (
    <ObjectFormPage
      backHref={ROUTES.marketingAbm}
      backLabel="All programs"
      title="New program"
      onSubmit={submit}
      saving={pending}
      saveLabel="Create program"
      error={error}
      maxWidth={760}
    >
      <Card padding={18} title="The program">
        <Field label="Name" required><Input value={form.name} onChange={set("name")} placeholder="e.g. Riyadh developers 2027" autoFocus /></Field>
        <div className="fg2">
          <Field label="Kind" info={ABM_TIPS.kind}>
            <Select value={form.kind} onChange={set("kind")}>{PROGRAM_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
          </Field>
          <Field label="Owner" info={ABM_TIPS.programOwner}>
            <Select value={form.owner_user_id} onChange={set("owner_user_id")}>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Goal" info={ABM_TIPS.goal}>
          <Textarea value={form.goal} onChange={set("goal")} rows={2} />
        </Field>
        <div className="fg2">
          <Field label="Measured in"><Select value={form.goal_metric} onChange={set("goal_metric")}>{GOAL_METRICS.map((m) => <option key={m} value={m}>{GOAL_METRIC_LABEL[m]}</option>)}</Select></Field>
          <Field label="Target"><Input type="number" min={0} value={form.goal_target} onChange={set("goal_target")} placeholder="e.g. 3" /></Field>
          <Field label="Starts on"><Input type="date" value={form.starts_on} onChange={set("starts_on")} /></Field>
          <Field label="Ends on"><Input type="date" value={form.ends_on} onChange={set("ends_on")} /></Field>
        </div>
      </Card>

      <Card padding={18} title="How each company is worked">
        <Field label="Default tier" info={ABM_TIPS.defaultTier}>
          <Select value={form.default_tier} onChange={set("default_tier")}>{ABM_TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]} — {TIER_HINT[t]}</option>)}</Select>
        </Field>
        <Field label="Roles every company needs" info={ABM_TIPS.requiredRoles}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {REQUIRABLE_ROLES.map((r) => (
              <label key={r} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} /> {ROLE_LABEL[r]}
              </label>
            ))}
          </div>
        </Field>
      </Card>

      <Card padding={18} title="Start the target list from">
        <Field label="Source" info={ABM_TIPS.source} style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Select value={source.kind} onChange={(e) => setSource({ kind: e.target.value as "none" | "group" | "segment", id: "" })} style={{ maxWidth: 220 }}>
              <option value="none">Start empty</option>
              <option value="group">A marketing target group</option>
              <option value="segment">A Coverage segment</option>
            </Select>
            {source.kind !== "none" && (
              <Select value={source.id} onChange={(e) => setSource((s) => ({ ...s, id: e.target.value }))} style={{ maxWidth: 320 }}>
                <option value="">— Choose —</option>
                {(source.kind === "group" ? groups : segments).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            )}
          </div>
        </Field>
      </Card>
    </ObjectFormPage>
  );
}
