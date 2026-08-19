"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Nova — Account 360. A side drawer holding everything about one account:
 * the health rating and what moved it, what to do next, then a card per
 * dimension (pipeline, revenue, service, people, installed base, coverage)
 * followed by whatever external sources the tenant plugged in.
 *
 * Opened by a `nova:open-account-360` CustomEvent carrying the account id,
 * so any surface can raise it (list row, detail header, palette later)
 * without importing the drawer or holding its state.
 */

type Tone = "good" | "warn" | "bad" | "neutral";
type Stat = { label: string; value: string; hint?: string; tone?: Tone };
type Row = { title: string; meta?: string; value?: string; tone?: Tone; href?: string };
type Card = {
  id: string; title: string; subtitle?: string; kind: "internal" | "external";
  stats?: Stat[]; rows?: Row[]; empty?: string; error?: string;
};
type Payload = {
  account: { id: string; name: string; ref: string | null; type: string; city: string | null; industry: string | null; since: string };
  rating: { score: number; grade: "A" | "B" | "C" | "D"; label: string; factors: { label: string; points: number; detail: string }[] };
  suggestions: { id: string; title: string; detail: string; urgency: "high" | "medium" | "low"; href?: string }[];
  cards: Card[];
};

const TONE_COLOR: Record<Tone, string> = {
  good: "#12a150",
  warn: "#d97706",
  bad: "#e5484d",
  neutral: "var(--modern-accent, var(--accent))",
};
const GRADE_COLOR: Record<string, string> = { A: "#12a150", B: "#12a150", C: "#d97706", D: "#e5484d" };
const URGENCY_COLOR: Record<string, string> = { high: "#e5484d", medium: "#d97706", low: "var(--muted, #8b93a1)" };

export default function Account360Drawer() {
  const router = useRouter();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const close = useCallback(() => {
    setAccountId(null);
    setData(null);
    setError(null);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) { setData(null); setError(null); setAccountId(id); }
    };
    window.addEventListener("nova:open-account-360", onOpen);
    return () => window.removeEventListener("nova:open-account-360", onOpen);
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/nova/account-360/${accountId}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(json.error ?? "Could not load this account");
        else setData(json as Payload);
      })
      .catch(() => { if (!cancelled) setError("Could not reach the server"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [accountId, close]);

  if (!accountId) return null;

  function go(href: string) {
    close();
    router.push(href);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Account 360"
      style={{ position: "fixed", inset: 0, zIndex: 500, display: "flex", justifyContent: "flex-end" }}
    >
      <div onClick={close} style={{ position: "absolute", inset: 0, background: "rgba(8,12,20,.5)", backdropFilter: "blur(2px)" }} />

      <aside
        className="a360-panel"
        style={{
          position: "relative", width: "min(560px, 100%)", height: "100%", overflowY: "auto",
          background: "var(--sb-panel-bg, #fff)", borderLeft: "1px solid var(--sb-panel-border, #e5e7eb)",
          boxShadow: "-24px 0 60px rgba(0,0,0,.28)",
        }}
      >
        <style>{`@keyframes a360-in { from { transform: translateX(24px); opacity: .4 } to { transform: none; opacity: 1 } }
          .a360-panel { animation: a360-in .18s ease-out }
          @media (prefers-reduced-motion: reduce) { .a360-panel { animation: none } }`}</style>

        <header style={{
          position: "sticky", top: 0, zIndex: 2, padding: "16px 20px 14px",
          background: "var(--sb-panel-bg, #fff)", borderBottom: "1px solid var(--sb-panel-border, #e5e7eb)",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 750, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--sb-panel-text-dim, #8b93a1)" }}>
                Account 360
              </div>
              <h2 style={{ margin: "3px 0 0", fontSize: 17, fontWeight: 750, color: "var(--sb-panel-text, #111827)", lineHeight: 1.25 }}>
                {data?.account.name ?? "Loading…"}
              </h2>
              {data && (
                <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--sb-panel-text-dim, #8b93a1)" }}>
                  {[data.account.ref, data.account.industry, data.account.city].filter(Boolean).join(" · ") || data.account.type}
                </div>
              )}
            </div>
            <button onClick={close} aria-label="Close" style={{
              width: 30, height: 30, flexShrink: 0, borderRadius: 8, cursor: "pointer",
              border: "1px solid var(--sb-panel-border, #e5e7eb)", background: "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="var(--sb-panel-text-dim, #8b93a1)" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <div style={{ padding: "16px 20px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
          {loading && !data && <SkeletonBody />}
          {error && (
            <div style={{ padding: 16, borderRadius: 12, border: "1px solid #e5484d55", fontSize: 12.5, color: "#e5484d" }}>
              {error}
            </div>
          )}

          {data && (
            <>
              <RatingBlock rating={data.rating} />

              {data.suggestions.length > 0 && (
                <section style={panel}>
                  <h3 style={panelTitle}>What to do next</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {data.suggestions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => s.href && go(s.href)}
                        style={{
                          display: "flex", gap: 10, textAlign: "left", width: "100%", font: "inherit",
                          padding: "10px 11px", borderRadius: 10, cursor: s.href ? "pointer" : "default",
                          border: "1px solid var(--sb-panel-border, #e5e7eb)", background: "transparent",
                        }}
                      >
                        <span style={{ width: 6, borderRadius: 4, flexShrink: 0, background: URGENCY_COLOR[s.urgency], alignSelf: "stretch" }} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--sb-panel-text, #111827)" }}>{s.title}</span>
                          <span style={{ display: "block", fontSize: 11.5, marginTop: 2, lineHeight: 1.5, color: "var(--sb-panel-text-dim, #8b93a1)" }}>{s.detail}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {data.cards.map((card) => (
                <section key={card.id} style={panel}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: card.stats?.length ? 12 : 9 }}>
                    <h3 style={{ ...panelTitle, margin: 0 }}>{card.title}</h3>
                    {card.subtitle && (
                      <span style={{ fontSize: 11, color: "var(--sb-panel-text-dim, #8b93a1)" }}>{card.subtitle}</span>
                    )}
                    {card.kind === "external" && (
                      <span style={{
                        marginLeft: "auto", fontSize: 9.5, fontWeight: 750, letterSpacing: ".06em", textTransform: "uppercase",
                        padding: "2px 6px", borderRadius: 5, color: "var(--sb-panel-text-dim, #8b93a1)",
                        border: "1px solid var(--sb-panel-border, #e5e7eb)",
                      }}>
                        Source
                      </span>
                    )}
                  </div>

                  {card.error && (
                    <p style={{ margin: 0, fontSize: 11.5, color: "#d97706", lineHeight: 1.5 }}>{card.error}</p>
                  )}

                  {card.stats && card.stats.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))", gap: 10, marginBottom: card.rows?.length ? 12 : 0 }}>
                      {card.stats.map((s) => (
                        <div key={s.label}>
                          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--sb-panel-text-dim, #8b93a1)" }}>{s.label}</div>
                          <div style={{
                            fontSize: 16, fontWeight: 750, marginTop: 2, fontVariantNumeric: "tabular-nums",
                            color: s.tone ? TONE_COLOR[s.tone] : "var(--sb-panel-text, #111827)",
                          }}>
                            {s.value}
                          </div>
                          {s.hint && <div style={{ fontSize: 10.5, marginTop: 1, color: "var(--sb-panel-text-dim, #8b93a1)" }}>{s.hint}</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  {card.rows && card.rows.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {card.rows.map((r, i) => {
                        const inner = (
                          <>
                            <span style={{ minWidth: 0, flex: 1 }}>
                              <span style={{ display: "block", fontSize: 12, fontWeight: 650, color: "var(--sb-panel-text, #111827)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {r.title}
                              </span>
                              {r.meta && (
                                <span style={{ display: "block", fontSize: 11, marginTop: 1, color: "var(--sb-panel-text-dim, #8b93a1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {r.meta}
                                </span>
                              )}
                            </span>
                            {r.value && (
                              <span style={{
                                fontSize: 11.5, fontWeight: 700, flexShrink: 0, fontVariantNumeric: "tabular-nums",
                                color: r.tone ? TONE_COLOR[r.tone] : "var(--sb-panel-text-dim, #8b93a1)",
                              }}>
                                {r.value}
                              </span>
                            )}
                          </>
                        );
                        const style: React.CSSProperties = {
                          display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                          padding: "8px 0", font: "inherit", background: "transparent", border: "none",
                          borderTop: i === 0 ? "none" : "1px solid var(--sb-panel-border, #e5e7eb)",
                        };
                        return r.href ? (
                          <button key={`${r.title}-${i}`} onClick={() => go(r.href!)} style={{ ...style, cursor: "pointer" }}>{inner}</button>
                        ) : (
                          <div key={`${r.title}-${i}`} style={style}>{inner}</div>
                        );
                      })}
                    </div>
                  )}

                  {!card.error && !card.stats?.length && !card.rows?.length && (
                    <p style={{ margin: 0, fontSize: 11.5, color: "var(--sb-panel-text-dim, #8b93a1)", lineHeight: 1.5 }}>
                      {card.empty ?? "Nothing here yet"}
                    </p>
                  )}
                </section>
              ))}

              <button
                onClick={() => go(`/accounts/${data.account.id}`)}
                style={{
                  padding: "10px 14px", borderRadius: 10, cursor: "pointer", font: "inherit",
                  fontSize: 12.5, fontWeight: 700, color: "var(--sb-panel-text, #111827)",
                  border: "1px solid var(--sb-panel-border, #e5e7eb)", background: "transparent",
                }}
              >
                Open the full account record
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

const panel: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 14,
  border: "1px solid var(--sb-panel-border, #e5e7eb)",
  background: "color-mix(in srgb, var(--sb-panel-text, #111827) 3%, transparent)",
};
const panelTitle: React.CSSProperties = {
  margin: "0 0 9px",
  fontSize: 12.5,
  fontWeight: 750,
  color: "var(--sb-panel-text, #111827)",
};

function RatingBlock({ rating }: { rating: Payload["rating"] }) {
  const color = GRADE_COLOR[rating.grade];
  return (
    <section style={panel}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Dial score={rating.score} color={color} grade={rating.grade} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 750, color }}>{rating.label}</div>
          <div style={{ fontSize: 11.5, marginTop: 2, color: "var(--sb-panel-text-dim, #8b93a1)", lineHeight: 1.5 }}>
            Health {rating.score}/100 — from recency, win rate, payment, service and relationship depth.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
        {rating.factors.map((f) => (
          <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 78, flexShrink: 0, fontSize: 11, fontWeight: 650, color: "var(--sb-panel-text, #111827)" }}>{f.label}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", height: 5, borderRadius: 3, background: "color-mix(in srgb, var(--sb-panel-text, #111827) 10%, transparent)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${Math.min(100, f.points * 4)}%`, background: color, borderRadius: 3 }} />
              </span>
              <span style={{ display: "block", fontSize: 10.5, marginTop: 3, color: "var(--sb-panel-text-dim, #8b93a1)" }}>{f.detail}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Dial({ score, color, grade }: { score: number; color: string; grade: string }) {
  const r = 26;
  const circumference = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: 64, height: 64, flexShrink: 0 }}>
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6"
          stroke="color-mix(in srgb, var(--sb-panel-text, #111827) 10%, transparent)" />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" stroke={color} strokeLinecap="round"
          strokeDasharray={`${(score / 100) * circumference} ${circumference}`} />
      </svg>
      <span style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 19, fontWeight: 800, color, fontVariantNumeric: "tabular-nums",
      }}>
        {grade}
      </span>
    </div>
  );
}

function SkeletonBody() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-hidden="true">
      {[92, 150, 132].map((h, i) => (
        <div key={i} style={{
          height: h, borderRadius: 14,
          border: "1px solid var(--sb-panel-border, #e5e7eb)",
          background: "color-mix(in srgb, var(--sb-panel-text, #111827) 4%, transparent)",
        }} />
      ))}
    </div>
  );
}
