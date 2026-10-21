"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import s from "./webhooks.module.css";
import type { TokenChoice } from "./api";
import { bareToken, groupTokens } from "./logic";
import { WEBHOOK_TIPS } from "./tips";

/**
 * Chips for the tokens a template may use, grouped by what they belong to. Closed until asked for so the Request tab
 * stays short; a pick goes to the caret through `onPick`. A personal-data token carries a tag, because it is only
 * sent when "Send personal data" is on.
 */
export default function TokenPicker({ tokens, loading, error, onPick, startOpen = false }: {
  tokens: readonly TokenChoice[]; loading: boolean; error?: string | null; onPick: (token: string) => void; startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [query, setQuery] = useState("");
  const groups = groupTokens(tokens, query);

  return (
    <div className={s.block}>
      <div className="bpm-label-row">
        <Button size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide tokens" : "Insert a token"}</Button>
        <InfoTip label="Tokens">{WEBHOOK_TIPS.tokens}</InfoTip>
      </div>
      {open && (
        <div className={s.picker}>
          {error ? <div className={s.issue} role="alert">{error}</div> : null}
          {loading && tokens.length === 0 ? <p className={s.greyLine} role="status">Loading…</p> : null}
          {tokens.length > 8 && <Input aria-label="Find a token" placeholder="Find a token" value={query} onChange={(e) => setQuery(e.target.value)} />}
          <div className={s.tokenScroll}>
            {groups.map((g) => (
              <div key={g.id} className={s.tokenGroup}>
                <div className={s.tokenGroupName}>{g.label}</div>
                <div className={s.tokens}>
                  {g.tokens.map((t) => (
                    <button key={t.token} type="button" className={`${s.token} ${t.pii ? s.tokenPii : ""}`} title={`{{${bareToken(t.token)}}}`} onClick={() => onPick(t.token)}>
                      {t.label}
                      {t.pii ? <span className={s.tokenTag}>personal</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!loading && !error && groups.length === 0 ? <p className={s.greyLine}>No token matches.</p> : null}
          </div>
        </div>
      )}
    </div>
  );
}
