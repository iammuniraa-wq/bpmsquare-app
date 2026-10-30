"use client";

import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import type { PartialAnswers, Question } from "@/lib/tender/competitors/researchRules";

// The questions market research asks before it searches, one at a time, as option chips (the shape of the dock's "How to fill in the
// details" row). Nothing runs until the last one is answered; answered questions shrink to one muted line. The answers are context for
// the person: they are kept on the tender and shown on the tab, never written to a tender field.

const chip: React.CSSProperties = {
  background: "var(--accentbg)", border: "1px solid var(--line)", borderRadius: 999, padding: "6px 14px", minHeight: 44,
  fontSize: 13, fontWeight: 650, color: c.accent, cursor: "pointer", fontFamily: "inherit",
};

export default function ResearchQuestions({ questions, answers, disabled, onAnswer, onCancel }: {
  /** The questions the server said are open, in the order to ask. */
  questions: Question[];
  answers: PartialAnswers;
  disabled?: boolean;
  onAnswer: (key: Question["key"], value: string) => void;
  onCancel: () => void;
}) {
  const answered = questions.filter((q) => answers[q.key]);
  const next = questions.find((q) => !answers[q.key]);
  return (
    <div data-guide="competitor.research.questions" role="group" aria-label="Before searching" style={{ border: `1px solid ${c.line}`, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      {answered.map((q) => (
        <div key={q.key} style={{ fontSize: 12, color: c.hint }}>{q.text} {q.options.find((o) => o.value === answers[q.key])?.label}</div>
      ))}
      {next && (
        <>
          <div style={{ fontSize: 13, fontWeight: 650, color: c.ink }}>{next.text}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {next.options.map((o) => (
              <button key={o.value} type="button" disabled={disabled} data-guide="competitor.research.option" style={chip} onClick={() => onAnswer(next.key, o.value)}>{o.label}</button>
            ))}
          </div>
        </>
      )}
      <div>
        <Button variant="quiet" size="sm" data-guide="competitor.research.cancel" style={{ minHeight: 44 }} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
