"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import { LEAD_STAGES, type LeadStageKey } from "@/lib/marketing/leadStages";

const select: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 10px", fontSize: 13, color: c.ink, background: c.panel, outline: "none",
};
const hintStyle: React.CSSProperties = { fontSize: 12, color: c.hint, marginTop: 4, lineHeight: 1.4 };
const errStyle: React.CSSProperties = { fontSize: 12, color: "var(--err-ink)", marginTop: 6 };

async function post(url: string, body?: unknown): Promise<{ ok: boolean; error?: string; json: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return res.ok ? { ok: true, json } : { ok: false, error: (json.error as string) ?? "Something went wrong", json };
  } catch {
    return { ok: false, error: "Could not reach the server", json: {} };
  }
}

/** Move the lead to another stage. A comment is optional. */
export function StageControl({ leadId, stage }: { leadId: string; stage: LeadStageKey }) {
  const router = useRouter();
  const [value, setValue] = useState<LeadStageKey>(stage);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const def = LEAD_STAGES.find((s) => s.key === value)!;
  return (
    <div>
      <label htmlFor="lead-stage" style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>Stage</label>
      <select id="lead-stage" style={{ ...select, marginTop: 4 }} value={value} onChange={(e) => setValue(e.target.value as LeadStageKey)}>
        {LEAD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <div style={hintStyle}>{def.hint}</div>
      {value !== stage && (
        <>
          <input style={{ ...select, marginTop: 8 }} placeholder="Add a note (optional)" aria-label="Note for the stage change" value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />
          <div style={{ marginTop: 8 }}>
            <Button
              variant="primary" size="sm" loading={pending}
              onClick={() => start(async () => {
                setError("");
                const r = await post(`/api/leads/${leadId}/stage`, { stage: value, comment });
                if (!r.ok) { setError(r.error ?? "Could not change the stage"); return; }
                setComment("");
                router.refresh();
              })}
            >
              Move to {def.label}
            </Button>
          </div>
        </>
      )}
      {error && <div role="alert" style={errStyle}>{error}</div>}
    </div>
  );
}

export type PersonOption = { user_id: string; label: string };

/** Pick the owner, or take the lead yourself. */
export function OwnerControl({ leadId, ownerId, people, me }: { leadId: string; ownerId: string | null; people: PersonOption[]; me: string }) {
  const router = useRouter();
  const [value, setValue] = useState(ownerId ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const save = (target: string | null) => start(async () => {
    setError("");
    const r = await post(`/api/marketing/leads/${leadId}/owner`, { user_id: target });
    if (!r.ok) { setError(r.error ?? "Could not change the owner"); return; }
    router.refresh();
  });
  return (
    <div>
      <label htmlFor="lead-owner" style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>Owner</label>
      <select id="lead-owner" style={{ ...select, marginTop: 4 }} value={value} disabled={pending} onChange={(e) => { setValue(e.target.value); save(e.target.value || null); }}>
        <option value="">Nobody yet</option>
        {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.label}</option>)}
      </select>
      <div style={hintStyle}>The salesperson who follows this lead up. Changing it never changes who owns the company.</div>
      {ownerId !== me && (
        <div style={{ marginTop: 8 }}>
          <Button size="sm" loading={pending} onClick={() => { setValue(me); save("me"); }}>Take this lead</Button>
        </div>
      )}
      {error && <div role="alert" style={errStyle}>{error}</div>}
    </div>
  );
}

/** The one next step for a lead that is ready: pick it up. Stops the response clock. */
export function AcceptButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <span>
      <Button
        variant="primary" loading={pending} title="Take this lead and start following it up"
        onClick={() => start(async () => {
          setError("");
          const r = await post(`/api/leads/${leadId}/stage`, { stage: "working" });
          if (!r.ok) { setError(r.error ?? "Could not pick this lead up"); return; }
          router.refresh();
        })}
      >
        Pick this up
      </Button>
      {error && <span role="alert" style={{ ...errStyle, marginLeft: 8 }}>{error}</span>}
    </span>
  );
}

/** Work the score out again now, from the same events and rules the nightly run uses. */
export function RescoreButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <span>
      <Button
        size="sm" loading={pending} title="Work the score out again now"
        onClick={() => start(async () => {
          setError("");
          const r = await post(`/api/marketing/leads/${leadId}/rescore`);
          if (!r.ok) { setError(r.error ?? "Could not score this lead"); return; }
          router.refresh();
        })}
      >
        Score again
      </Button>
      {error && <span role="alert" style={{ ...errStyle, marginLeft: 8 }}>{error}</span>}
    </span>
  );
}
