"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import type { SkipGroup } from "@/lib/newsletter/audienceWords";
import { languageDef } from "@/lib/newsletter/types";
import type { ComposeNewsletter } from "@/lib/newsletter/composeData";

// Two read-only helpers on the campaign hand-over. Both make exactly the decisions the real send
// makes (same function on the server) and neither sends or records anything.

type Plan = { total: number; contactable: number; byLanguage: Record<string, number>; groups: SkipGroup[] };
export type SendSettings = {
  newsletter: ComposeNewsletter; languages: string[]; fallback: string; topic: string | null;
  audienceRule: () => Record<string, unknown>;
};

const langName = (code: string) => languageDef(code)?.name ?? code;
const small: React.CSSProperties = { fontSize: 12.5, color: c.muted, margin: 0 };

export function AudiencePanel({ newsletter, languages, fallback, topic, audienceRule }: SendSettings) {
  const [plan, setPlan] = useState<(Plan & { key: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lang, setLang] = useState("");
  const selected = languages.includes(lang) ? lang : languages.includes(fallback) ? fallback : languages[0] ?? "";

  const body = () => ({ newsletter_version_id: newsletter.versionId, languages, fallback_language: fallback, topic, ...audienceRule() });
  const key = JSON.stringify(body());

  async function check() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/newsletters/audience", { method: "POST", headers: { "Content-Type": "application/json" }, body: key });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not check the audience");
      setPlan({ ...json, key });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const stale = plan !== null && plan.key !== key;
  const others = plan ? Object.entries(plan.byLanguage).filter(([l]) => l !== selected) : [];
  const gaps = plan ? plan.total - plan.contactable : 0;

  return (
    <Card title="Who will get this" action={<span style={{ fontSize: 11, color: c.hint }}>nothing is sent</span>}>
      <p style={{ ...small, marginBottom: 10 }}>
        Checks every person in the audience the way the send will: consent for this topic, the person behind the address, and the language each would get.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <Button onClick={() => void check()} loading={busy} disabled={languages.length === 0}>{plan ? "Check again" : "Check the audience"}</Button>
        {languages.length > 1 && (
          <label style={{ fontSize: 12.5, color: c.muted, display: "flex", gap: 6, alignItems: "center" }}>
            Language
            <select aria-label="Language to look at" value={selected} onChange={(e) => setLang(e.target.value)} style={{ padding: "6px 8px", border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink }}>
              {languages.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
            </select>
          </label>
        )}
      </div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
      {plan && (
        <div aria-live="polite" style={{ display: "grid", gap: 10, opacity: stale ? 0.55 : 1 }}>
          {stale && <p style={{ ...small, color: "var(--amberink)" }}>You changed something since this check. Check again for the new numbers.</p>}
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.ink }}>{plan.contactable} of {plan.total} people</div>
            <p style={small}>can be emailed{gaps > 0 ? `; ${gaps} would be left out` : ""}.</p>
          </div>
          {selected && (
            <div style={{ fontSize: 13, color: c.ink }}>
              <b>{plan.byLanguage[selected] ?? 0}</b> would get {langName(selected)}
              {others.length > 0 && <span style={{ color: c.muted }}> · {others.map(([l, n]) => `${langName(l)} ${n}`).join(" · ")}</span>}
            </div>
          )}
          {plan.groups.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>Who is left out, and why</div>
              {plan.groups.map((g) => (
                <div key={g.id} style={{ fontSize: 13, color: c.ink }}>
                  <b>{g.count}</b> {g.label}.
                  {g.fix && <span style={{ display: "block", fontSize: 12, color: c.muted }}>{g.fix}</span>}
                </div>
              ))}
              <Link href={ROUTES.contacts} style={{ fontSize: 12.5, color: c.accent, fontWeight: 600 }}>Open the people list</Link>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

type Found = { kind: "contact" | "account"; id: string; name: string; account_name: string | null };
type Seen = { name: string; lang: string; explanation: string; note: string; subject: string; html: string };

export function SeeAsPerson({ newsletter, languages, fallback, topic }: Omit<SendSettings, "audienceRule">) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [seen, setSeen] = useState<Seen | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onType(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (v.trim().length < 2) { setFound([]); return; }
      const res = await fetch(`/api/newsletters/people?q=${encodeURIComponent(v.trim())}`);
      const json = await res.json().catch(() => ({ people: [] }));
      setFound(res.ok ? json.people : []);
    }, 250);
  }

  async function look(p: Found) {
    setBusy(true); setError(""); setFound([]); setQ(p.name);
    try {
      const res = await fetch("/api/newsletters/preview-as", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newsletter_version_id: newsletter.versionId, languages, fallback_language: fallback, topic, ...(p.kind === "contact" ? { contact_id: p.id } : { account_id: p.id }) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not build the preview");
      setSeen(json);
    } catch (e) {
      setSeen(null); setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="See it as this person" action={<span style={{ fontSize: 11, color: c.hint }}>nothing is sent</span>}>
      <p style={{ ...small, marginBottom: 8 }}>Pick a contact or a company to see the email they would receive, in the language they would get.</p>
      <input
        aria-label="Search for a contact or company" value={q} placeholder="Start typing a name…" onChange={(e) => onType(e.target.value)}
        style={{ width: "100%", padding: "9px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, boxSizing: "border-box" }}
      />
      {found.length > 0 && (
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, border: `1px solid ${c.line}`, borderRadius: 8 }}>
          {found.map((p) => (
            <li key={`${p.kind}${p.id}`}>
              <button type="button" onClick={() => void look(p)} style={{ width: "100%", textAlign: "left", padding: "8px 10px", border: 0, background: "transparent", color: c.ink, cursor: "pointer", font: "inherit", fontSize: 13 }}>
                {p.name} <span style={{ color: c.muted, fontSize: 12 }}>{p.kind === "contact" ? `contact${p.account_name ? ` at ${p.account_name}` : ""}` : "company"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {busy && <p style={{ ...small, marginTop: 8 }}>Building the preview…</p>}
      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)", marginTop: 8 }}>{error}</div>}
      {seen && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }} aria-live="polite">
          <p style={{ margin: 0, fontSize: 13, color: c.ink }}>{seen.explanation}</p>
          <p style={small}>{seen.note}</p>
          <p style={{ ...small, color: c.ink }}>Subject: <b>{seen.subject}</b></p>
          <iframe title={`The email as ${seen.name} would get it`} sandbox="" srcDoc={seen.html} style={{ width: "100%", height: 460, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel }} />
        </div>
      )}
    </Card>
  );
}
