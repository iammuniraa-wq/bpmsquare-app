// Live check of the assistant's "go to a screen" path against the real model. NOT part of CI or vitest: it spends
// a few cents of the Anthropic key in your environment (about 30 short calls on the small model).
//
//   (PowerShell, from the repository root)
//   $env:ANTHROPIC_API_KEY = "sk-ant-..."
//   $env:JITI_ALIAS = '{"@":"C:/Users/<you>/Documents/bpmsquare-app/src"}'   (absolute path to src, forward slashes)
//   npx jiti scripts/assistant-nav-eval.ts           run both profiles, print a table, exit 1 on any failure
//   npx jiti scripts/assistant-nav-eval.ts --print   list the questions and what each should do, no API calls
//
// What it runs, per question, in the product's own order: the model-free shortcuts (matchNavigation, answerUnavailableAsk),
// then ONE real model call with the product's navigate tool and NAVIGATION block (navigateTool, navigationPromptBlock),
// then the server's check of the pick (judgeNavigation). It does not run askAssistant itself (that needs a database
// session); the persona text is shortened, so the exact wording of the answer can differ in the dock. What it proves is
// that the tool, the list and the check hold against what the model really does with them.
//
// Two workspaces: a KAMCO-like one (tender edition on, Data Workbench off, admin) and a restricted member (every module
// on, Business Role that views Accounts and Cases only). A failure prints the question, what was expected and what came back.

import Anthropic from "@anthropic-ai/sdk";
import { answerUnavailableAsk, judgeNavigation, NAV_NONE } from "../src/lib/assistant/navGuard";
import { buildNavTargets, matchNavigation, navigationPromptBlock, type NavGateCtx } from "../src/lib/assistant/navTargets";
import { boqUploadRule } from "../src/lib/assistant/boqHelp";
import { navigateTool } from "../src/lib/assistant/navTools";
import { NAV } from "../src/lib/constants";
import { CREATE_ACTIONS } from "../src/lib/createActions";
import { SETTINGS_MENU } from "../src/lib/settingsMenu";
import { smallModel } from "../src/lib/assistant/models";
import type { WorkcenterKey } from "../src/lib/workcenters";

type Expect =
  | { kind: "open"; anyOf: string[] }
  | { kind: "unavailable"; includes: string }
  | { kind: "unknown" }
  // A BOQ information question: the answer text (or the server's "not switched on" reply) must mention one of includesAny and none of excludes.
  | { kind: "says"; includesAny: string[]; excludes: string[] };
type Q = { say: string; expect: Expect };
type Profile = { name: string; ctx: NavGateCtx; questions: Q[] };

function featuresFrom(keys: string[]): Record<string, boolean> {
  return Object.fromEntries(keys.map((k) => [k, true]));
}
function everyFeature(): string[] {
  const keys = new Set<string>();
  const walk = (items: (typeof NAV)[number]["items"]) => items.forEach((i) => { if (i.featureKey) keys.add(i.featureKey); walk(i.children ?? []); });
  NAV.forEach((g) => walk(g.items));
  CREATE_ACTIONS.forEach((a) => keys.add(a.featureKey));
  SETTINGS_MENU.forEach((m) => { if (m.featureKey) keys.add(m.featureKey); (m.featureAnyOf ?? []).forEach((k) => keys.add(k)); });
  return [...keys];
}

const open = (...anyOf: string[]): Expect => ({ kind: "open", anyOf });
const missing = (includes: string): Expect => ({ kind: "unavailable", includes });
const says = (includesAny: string[], excludes: string[] = []): Expect => ({ kind: "says", includesAny, excludes });

const KAMCO: Profile = {
  name: "KAMCO-like admin (tender edition on, Data Workbench off)",
  ctx: {
    features: featuresFrom(["accounts", "contacts", "pipeline", "gcc_tender", "reports", "estimator", "contract_projects", "rfq"]),
    isAdmin: true, isWfmSupervisor: false, canView: () => true, canCreate: () => true, canEdit: () => true,
  },
  questions: [
    { say: "where is data workbench", expect: missing("Data Workbench is not switched on") },
    { say: "I need the data workbench for a big upload", expect: missing("Data Workbench is not switched on") },
    { say: "can you take me to the data import tool", expect: missing("Data Workbench is not switched on") },
    { say: "how do I bulk import from Excel", expect: missing("Data Workbench is not switched on") },
    { say: "analytics", expect: open("nav:/reports") },
    { say: "where can I see analytics", expect: open("nav:/reports") },
    { say: "open tenders", expect: open("nav:/pipeline?tab=tenders") },
    { say: "where do I see my tenders", expect: open("nav:/pipeline?tab=tenders") },
    { say: "how do I upload a BOQ", expect: open("nav:/pipeline?tab=tenders") },
    { say: "where are my estimates", expect: open("nav:/estimates") },
    { say: "where are the invoices", expect: missing("Invoices is not switched on") },
    { say: "open the quotations", expect: missing("Quotations is not switched on") },
    { say: "where is the budget cockpit", expect: { kind: "unknown" } },
    { say: "where is the flux capacitor", expect: { kind: "unknown" } },
    { say: "where do I change the company logo", expect: open("settings:company") },
    { say: "where do I create a new account", expect: open("create:/accounts/new") },
    { say: "where is the pipeline", expect: open("nav:/pipeline") },
    // The tender BOQ: format, limits, bulk import (Data Workbench is off here, so it must be declined) and the API / MCP.
    { say: "which columns does the BOQ upload read", expect: says(["Narration", "Quantity"]) },
    { say: "can I use the client's own Excel for the BOQ or do I have to retype it", expect: says(["own Excel", "as it is", "Narration", "client"]) },
    { say: "what are the limits for a BOQ file", expect: says(["2,000"], ["unit_cost"]) },
    { say: "how do I bulk import and export BOQ lines", expect: says(["not switched on"], ["Tender BOQ lines"]) },
    { say: "can I pull the BOQ through the API", expect: says(["/api/v1/tenders"], ["unit_cost", "markup_pct"]) },
    { say: "which MCP tools give me the tender BOQ", expect: says(["get_tender_boq"], ["unit_cost"]) },
  ],
};

const MEMBER: Profile = {
  name: "restricted member (every module on; views Accounts and Cases only; not an admin)",
  ctx: {
    features: featuresFrom(everyFeature()),
    isAdmin: false, isWfmSupervisor: false,
    canView: (wc: WorkcenterKey) => wc === "accounts" || wc === "cases",
    canCreate: () => false, canEdit: () => false,
  },
  questions: [
    { say: "where is data workbench", expect: missing("You do not have access to Data Workbench.") },
    { say: "analytics", expect: missing("You do not have access to Analytics.") },
    { say: "where are my accounts", expect: open("nav:/accounts") },
    { say: "where are the cases", expect: open("nav:/cases") },
    { say: "take me to my customers", expect: open("nav:/accounts") },
    { say: "where can I find service tickets", expect: open("nav:/cases") },
    { say: "open quotations", expect: missing("You do not have access to Quotations.") },
    { say: "where do I see invoices", expect: missing("You do not have access to Invoices.") },
    { say: "where are the people settings", expect: missing("only for workspace administrators") },
    { say: "where can I create a new account", expect: missing("You do not have access to New Account.") },
    { say: "where is the flux capacitor", expect: { kind: "unknown" } },
    { say: "where is the weather forecast", expect: { kind: "unknown" } },
  ],
};

type Got = { kind: "open"; ids: string[]; via: string } | { kind: "unavailable"; text: string; via: string } | { kind: "unknown"; text: string; via: string } | { kind: "text"; text: string } | { kind: "invalid"; pick: string };

async function runOne(client: Anthropic, model: string, p: Profile, question: Q): Promise<Got> {
  const q = question.say;
  const targets = buildNavTargets(p.ctx);
  const direct = matchNavigation(q, targets);
  if (direct) return { kind: "open", ids: [direct.id], via: "shortcut" };
  const miss = answerUnavailableAsk(q, targets, p.ctx);
  if (miss) return { kind: "unavailable", text: miss, via: "server" };

  const system =
    "You are the BPMSquare Assistant, the in-app helper for a business running its sales, service and operations on BPMSquare. You take people to the screen they ask for.\n" +
    "To take someone to a screen use navigate. It only shows a button. Keep answers to one short line." +
    navigationPromptBlock(targets) + boqUploadRule(targets);
  const res = await client.messages.create({ model, max_tokens: 600, system, tools: [navigateTool(targets)], messages: [{ role: "user", content: q }] });
  const textOut = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(" ").trim().slice(0, 600);
  if (question.expect.kind === "says") return { kind: "text", text: textOut };
  const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "navigate");
  if (!tu) return { kind: "text", text: res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(" ").trim().slice(0, 600) };
  const input = tu.input as { target?: string; asked_for?: string };
  const pick = String(input.target ?? "");
  if (pick !== NAV_NONE && !targets.some((t) => t.id === pick)) return { kind: "invalid", pick };
  const v = judgeNavigation({ pick, askedFor: input.asked_for, message: q, targets, ctx: p.ctx });
  if (v.kind === "open") return { kind: "open", ids: v.targets.map((t) => t.id), via: `model(${pick}/${input.asked_for ?? ""})` };
  return { kind: v.kind, text: v.message, via: `model(${pick}/${input.asked_for ?? ""})` };
}

function passes(e: Expect, g: Got): boolean {
  if (e.kind === "says") {
    const text = g.kind === "text" || g.kind === "unavailable" || g.kind === "unknown" ? g.text : "";
    return e.includesAny.some((w) => text.toLowerCase().includes(w.toLowerCase())) && !e.excludes.some((w) => text.includes(w));
  }
  if (e.kind === "open") return g.kind === "open" && g.ids.length > 0 && g.ids.every((id) => e.anyOf.includes(id));
  if (e.kind === "unavailable") return g.kind === "unavailable" && g.text.includes(e.includes);
  return g.kind === "unknown";
}

const describeExpect = (e: Expect) => (e.kind === "says" ? `text with ${e.includesAny.join("|")}${e.excludes.length ? `, without ${e.excludes.join("|")}` : ""}` : e.kind === "open" ? `button ${e.anyOf.join("|")}` : e.kind === "unavailable" ? `says "${e.includes}"` : "unknown screen");
const describeGot = (g: Got) =>
  g.kind === "open" ? `button ${g.ids.join(",")} [${g.via}]`
  : g.kind === "invalid" ? `invalid pick ${g.pick}`
  : g.kind === "text" ? `text only: ${g.text}`
  : `${g.kind}: ${g.text} [${g.via}]`;

async function main() {
  const profiles = [KAMCO, MEMBER];
  if (process.argv.includes("--print")) {
    for (const p of profiles) { console.error(`\n${p.name}`); for (const q of p.questions) console.error(`  ${q.say}  ->  ${describeExpect(q.expect)}`); }
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) { console.error("Set ANTHROPIC_API_KEY first."); process.exit(2); }
  const client = new Anthropic();
  const model = smallModel();
  let failed = 0; let total = 0;
  for (const p of profiles) {
    console.error(`\n${p.name}   (model ${model})`);
    for (const q of p.questions) {
      total++;
      let g: Got;
      try { g = await runOne(client, model, p, q); } catch (e) { g = { kind: "text", text: `ERROR ${(e as Error).message}` }; }
      const ok = passes(q.expect, g);
      if (!ok) failed++;
      console.error(`  ${ok ? "PASS" : "FAIL"}  ${q.say}`);
      if (!ok) console.error(`        expected ${describeExpect(q.expect)}\n        got      ${describeGot(g)}`);
    }
  }
  console.error(`\n${total - failed}/${total} passed.`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
