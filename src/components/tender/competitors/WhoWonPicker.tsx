"use client";

import { useEffect, useState } from "react";
import { Input, Select } from "@/components/ui/Input";
import { COMPETITOR_LIMITS, sameCompany, type CompetitorView } from "@/lib/tender/competitors/rules";

// "Who won" on a tender: a choice over this deal's competitors plus "Someone else", whose name the server adds to the list and marks as
// the winner (the stage move to Lost and the Outcome save both do that). Until the list has loaded, when the deal has no competitors yet,
// or when the table is not there yet, it is the plain text box it replaced, so a lost tender can always be closed.

const OTHER = "__other";

export default function WhoWonPicker({ opportunityId, value, onChange, id, guide, initialCompetitors }: {
  opportunityId: string;
  /** The name typed or picked so far. */
  value: string;
  onChange: (name: string) => void;
  id?: string;
  guide?: string;
  /** Lets a server render (and its test) show the picker with its list. The page never passes it. */
  initialCompetitors?: Pick<CompetitorView, "id" | "name">[];
}) {
  const [list, setList] = useState<Pick<CompetitorView, "id" | "name">[]>(initialCompetitors ?? []);
  const [other, setOther] = useState(false);

  useEffect(() => {
    if (initialCompetitors) return;
    let live = true;
    fetch(`/api/opportunities/${opportunityId}/competitors`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j && !j.pending && Array.isArray(j.competitors)) setList(j.competitors); })
      .catch(() => {});
    return () => { live = false; };
  }, [opportunityId, initialCompetitors]);

  if (list.length === 0) {
    return <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={COMPETITOR_LIMITS.nameMax} placeholder="Who won (required)" aria-label="Who won" data-guide={guide} />;
  }
  const match = list.find((c) => value && sameCompany(c.name, value));
  const showOther = other || (!!value && !match);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Select
        id={id} aria-label="Who won" data-guide={guide} value={showOther ? OTHER : match?.name ?? ""}
        onChange={(e) => {
          if (e.target.value === OTHER) { setOther(true); onChange(""); } else { setOther(false); onChange(e.target.value); }
        }}
      >
        <option value="">Pick who won</option>
        {list.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        <option value={OTHER}>Someone else…</option>
      </Select>
      {showOther && (
        <Input value={value} onChange={(e) => onChange(e.target.value)} maxLength={COMPETITOR_LIMITS.nameMax} placeholder="Name of the company that won" aria-label="Name of the company that won" data-guide={guide ? `${guide}.other` : undefined} />
      )}
    </div>
  );
}
