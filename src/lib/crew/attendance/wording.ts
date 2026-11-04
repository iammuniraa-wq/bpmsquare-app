// Wording rules for anything the Attendance agent writes (design 5.5, owner decision on privacy). Three layers:
//   1. BANNED_TERMS: the design's tested constant, matched as word stems, case-insensitive. A hit drops the finding.
//   2. EXTRA_BANNED: pay and disciplinary language, inference about character, intent, and blame, which the design's list
//      does not enumerate but the goal forbids ("never judge honesty, never recommend any pay or disciplinary step").
//   3. Structure: no comparing or ranking people, no naming a person for a site-level pattern, no mention of an agent or AI
//      in text that can reach an employee, severity words are never "violation".
// The list is a constant on purpose: a change to it is a code change with a test, not a setting.

import { PERSON_ALIAS_TOKEN, personAliasesIn } from "./alias";

/** Exactly the design's list (docs/design/nova-crew-agents.md 5.5). */
export const BANNED_TERMS = [
  "fraud", "cheat", "proxy", "buddy", "lying", "theft", "steal", "suspicious", "deduct", "penalty", "penalise",
  "discipline", "terminate", "warning letter", "salary",
] as const;

export const EXTRA_BANNED = [
  // pay
  "payroll", "wage", "wages", "pay cut", "docked", "dock pay", "bonus", "increment", "appraisal", "withhold",
  // discipline and blame
  "disciplinary", "punish", "misconduct", "violation", "offence", "offense", "breach", "culprit", "guilty", "blame", "sack",
  // character and intent
  "dishonest", "dishonesty", "liar", "lied", "lazy", "careless", "irresponsible", "unreliable", "untrustworthy", "slacking", "slacker",
  "deliberate", "deliberately", "intentional", "intentionally", "on purpose", "excuse", "excuses", "attitude", "fake", "faking", "spoof",
  "ghost", "habitual", "chronic offender", "taking advantage", "avoiding work",
  // ranking
  "worst", "ranked", "ranking", "league table", "more often than", "less than the others",
] as const;

const ALL_BANNED: readonly string[] = [...BANNED_TERMS, ...EXTRA_BANNED];

/** Words that would reveal the agent to an employee, forbidden in a drafted recheck message only. */
export const AGENT_MENTIONS = ["ai", "a.i.", "agent", "assistant", "algorithm", "automated", "automatic", "bot", "flagged by"] as const;

function stemRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  // a word start; stems match their endings (penalise -> penalised, cheat -> cheating)
  return new RegExp(`(^|[^\\p{L}])${escaped}`, "iu");
}

const BANNED_REGEXES: [string, RegExp][] = ALL_BANNED.map((t) => [t, stemRegex(t)]);

/** Banned terms found in the text (each term once). */
export function bannedTermsIn(text: string): string[] {
  return BANNED_REGEXES.filter(([, re]) => re.test(text)).map(([t]) => t);
}

const AGENT_REGEXES = AGENT_MENTIONS.map((w) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu"));
export function agentMentionsIn(text: string): string[] {
  return AGENT_MENTIONS.filter((_, i) => AGENT_REGEXES[i].test(text));
}

/** Severity words shown to people. Never "violation". */
export const SEVERITY_LABEL = { info: "For information", review: "Worth a look", urgent: "Review soon" } as const;

export type WordingProblem =
  | { code: "banned_term"; detail: string }
  | { code: "compares_people"; detail: string }
  | { code: "names_person_for_site_pattern"; detail: string }
  | { code: "mentions_agent"; detail: string }
  | { code: "alias_in_message"; detail: string };

const COMPARISON =
  /\b(than|compared (to|with)|unlike|relative to|in contrast to)\b[^.]{0,40}\b(others|colleagues|peers|team|everyone|coworkers|co-workers|the rest)\b|\beveryone else\b/i;

/** All the text of a finding or proposal, one string per field. */
export function checkWording(
  texts: string[],
  opts: { level: "site" | "person" }
): WordingProblem[] {
  const problems: WordingProblem[] = [];
  const joined = texts.join("\n");
  for (const term of bannedTermsIn(joined)) problems.push({ code: "banned_term", detail: term });

  const aliases = personAliasesIn(joined);
  if (opts.level === "site" && aliases.length > 0) {
    problems.push({ code: "names_person_for_site_pattern", detail: aliases.join(",") });
  }
  if (opts.level === "person" && aliases.length > 1) {
    problems.push({ code: "compares_people", detail: aliases.join(",") });
  }
  if (opts.level === "person" && COMPARISON.test(joined)) {
    problems.push({ code: "compares_people", detail: "compared with others" });
  }
  return problems;
}

/** A drafted recheck message reaches an employee as their supervisor's own message: it must not mention an agent or AI. */
export function checkEmployeeFacingWording(text: string): WordingProblem[] {
  const problems: WordingProblem[] = [];
  for (const term of bannedTermsIn(text)) problems.push({ code: "banned_term", detail: term });
  for (const w of agentMentionsIn(text)) problems.push({ code: "mentions_agent", detail: w });
  if (text.match(PERSON_ALIAS_TOKEN)) problems.push({ code: "alias_in_message", detail: "alias left in message" });
  return problems;
}
