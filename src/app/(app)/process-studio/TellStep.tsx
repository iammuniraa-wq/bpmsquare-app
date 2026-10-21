"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Select, Textarea } from "@/components/ui/Input";
import { AREA_IDS, AREA_META, type AreaId } from "@/lib/studio/types";
import { MAX_MESSAGE_CHARS } from "@/lib/studio/caps";
import { studioApi, STUDIO_BASE, useStepRunner, type StepProps } from "./studioClient";
import { STUDIO_TIPS } from "@/lib/studio/tips";
import { Head, MiniEmpty, OptionGroup, Opt, Switch, cx } from "./ui";
import styles from "./studio.module.css";

const OPENING =
  "Tell us about your business in your own words: what you sell, who your customers are, and how a job goes from the first call to getting paid.";

export default function TellStep({ bundle, canEdit, toast, refresh }: StepProps) {
  const { study, messages } = bundle;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [openArea, setOpenArea] = useState<AreaId | null>(null);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const chatRef = useRef<HTMLDivElement>(null);
  const { run, busy } = useStepRunner(study.id, toast);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pendingText]);

  const answered = new Set(messages.filter((m) => m.role === "client" && m.area).map((m) => m.area));
  const hasMap = bundle.steps.length > 0;

  async function send(body: string, area: AreaId | null): Promise<boolean> {
    setSending(true);
    setPendingText(body);
    const res = await studioApi("POST", `${STUDIO_BASE}/${study.id}/chat`, { text: body, area });
    setSending(false);
    setPendingText(null);
    refresh();
    if (!res.ok) { toast(res.error); return false; }
    return true;
  }

  async function onSend() {
    const t = text.trim();
    if (!t || sending) return;
    setText("");
    if (!(await send(t, null))) setText(t);
  }

  async function saveArea(a: AreaId) {
    const meta = AREA_META[a];
    const parts = meta.questions.map((q, i) => (answers[i].trim() ? `${q}\n${answers[i].trim()}` : "")).filter(Boolean);
    if (parts.length === 0) { toast("Answer at least one question, or switch the area off."); return; }
    const ok = await send(`${meta.label}\n\n${parts.join("\n\n")}`.slice(0, MAX_MESSAGE_CHARS), a);
    if (ok) { setOpenArea(null); setAnswers(["", "", ""]); }
  }

  async function patch(body: Record<string, unknown>) {
    const res = await studioApi("PATCH", `${STUDIO_BASE}/${study.id}`, body);
    if (!res.ok) toast(res.error);
    refresh();
  }

  function toggleOff(a: AreaId, off: boolean) {
    const next: Record<string, { off: boolean }> = {};
    for (const [k, v] of Object.entries(study.areas)) if (v?.off) next[k] = { off: true };
    if (off) next[a] = { off: true }; else delete next[a];
    void patch({ areas: next });
  }

  return (
    <>
      <aside className={styles.panel} aria-label="Options">
        <OptionGroup id="p1areas" title="Areas of your business" info={STUDIO_TIPS.areas} defaultOpen>
          <div className={styles.areas}>
            {AREA_IDS.map((a) => {
              const off = !!study.areas[a]?.off;
              const done = answered.has(a);
              const open = openArea === a;
              return (
                <div key={a} style={{ display: "grid", gap: 6 }}>
                  <button
                    type="button" className={cx(styles.area, done && styles.done, off && styles.off)}
                    aria-expanded={open} disabled={!canEdit}
                    onClick={() => { setOpenArea(open ? null : a); setAnswers(["", "", ""]); }}
                  >
                    <span><span className={styles.areaName}>{AREA_META[a].label}</span><br /><span className={styles.areaSub}>{off ? "Not relevant to us" : AREA_META[a].blurb}</span></span>
                    <span className={styles.areaTag}>{done ? "Answered" : off ? "" : "Answer"}</span>
                  </button>
                  {open && (
                    <div className={styles.areaForm}>
                      {AREA_META[a].questions.map((q, i) => (
                        <label key={q}>{q}
                          <Textarea rows={2} value={answers[i]} maxLength={1200} onChange={(e) => setAnswers((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} />
                        </label>
                      ))}
                      <label className={styles.chk}>
                        <input type="checkbox" checked={off} onChange={(e) => toggleOff(a, e.target.checked)} />
                        <span>Not relevant to us</span>
                      </label>
                      <Button variant="primary" size="sm" loading={sending} onClick={() => void saveArea(a)}>Add to the conversation</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </OptionGroup>

        <OptionGroup id="p1docs" title="Documents you have" info={STUDIO_TIPS.docs}>
          <MiniEmpty title="Coming next release" text="For now, describe how you work in the conversation or paste a procedure into it." />
        </OptionGroup>

        <OptionGroup title="Studio options" info={STUDIO_TIPS.studioOptions}>
          <Opt label="Language" htmlFor="psd-lang" info={STUDIO_TIPS.language}>
            <Select id="psd-lang" value="en" onChange={() => undefined} disabled={!canEdit}>
              <option value="en">English</option>
              <option value="ar" disabled>Arabic (planned)</option>
            </Select>
          </Opt>
          <Switch
            label="Ask me follow-up questions" checked={study.follow_ups} disabled={!canEdit}
            info={STUDIO_TIPS.followUps}
            onChange={(v) => void patch({ follow_ups: v })}
          />
          {hasMap && (
            <Opt label="Build the map again" info={STUDIO_TIPS.buildMapAgain}>
              <Button size="sm" loading={busy === "map"} disabled={!canEdit} onClick={() => void run("map")}>Build again</Button>
            </Opt>
          )}
        </OptionGroup>
      </aside>

      <div className={styles.work}>
        <Card>
          <div id="w1chat">
            <Head title="Tell us how you work" info={STUDIO_TIPS.tellHead} />
            <div className={styles.chat} ref={chatRef} aria-live="polite" style={{ marginTop: 10 }}>
              {messages.length === 0 && !pendingText && (
                <div className={cx(styles.msg, styles.studio)}><div className={styles.who}>Studio</div>{OPENING}</div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={cx(styles.msg, m.role === "client" ? styles.client : styles.studio)}>
                  <div className={styles.who}>{m.role === "client" ? "You" : "Studio"}</div>
                  {m.text}
                  {m.questions.length > 0 && <ul>{m.questions.map((q) => <li key={q}>{q}</li>)}</ul>}
                  {m.understood.length > 0 && (
                    <div className={styles.chips}>
                      {m.understood.map((u) => (
                        <span key={u.fact} className={cx(styles.chip, u.kind === "assumed" && styles.assumed)}>{u.fact}{u.kind === "assumed" ? " · assumed" : ""}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {pendingText && (
                <>
                  <div className={cx(styles.msg, styles.client)}><div className={styles.who}>You</div>{pendingText}</div>
                  <div className={cx(styles.msg, styles.studio)} role="status"><div className={styles.who}>Studio</div>Reading what you wrote…</div>
                </>
              )}
            </div>
            {canEdit && (
              <div className={styles.compose}>
                <Textarea
                  aria-label="Your message" value={text} maxLength={MAX_MESSAGE_CHARS} disabled={sending}
                  placeholder="For example: a contractor sends us drawings, our estimator prices the panels in Excel, then we send a quote by email."
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void onSend(); } }}
                />
                <Button variant="primary" loading={sending} onClick={() => void onSend()}>Send</Button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
