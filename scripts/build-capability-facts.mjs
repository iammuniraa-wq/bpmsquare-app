// Reads the parts of the capability catalogue that exist only as TEXT in the
// source -- TenantFeatures (a type, gone at runtime), the TenantExtension
// interface, mcp-server/mcp.json and the hand-written docs/capabilities/*.md --
// and writes src/lib/capability/facts.generated.json.
//
//   node scripts/build-capability-facts.mjs          rewrite the JSON
//   node scripts/build-capability-facts.mjs --check  exit 1 if it is stale
//
// Everything else the catalogue needs (NAV, SETTINGS_MENU, FIELD_REGISTRY,
// LIST_SOURCES, the connector registry) is real runtime data and is imported by
// src/lib/capability/generate.ts directly. capability/catalog.test.ts fails the
// build when the committed JSON is stale or a module has no plain-words file,
// so run this after adding a module or editing a docs/capabilities file.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");
export const OUT = join(ROOT, "src", "lib", "capability", "facts.generated.json");

const firstSentence = (s) => {
  const t = s.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : t).slice(0, 220);
};

function featureFacts(root) {
  const src = readFileSync(join(root, "src", "lib", "constants.ts"), "utf8");
  const start = src.indexOf("export type TenantFeatures = {");
  if (start < 0) throw new Error("TenantFeatures not found in constants.ts");
  const end = src.indexOf("\n};", start);
  const out = [];
  let comment = [];
  for (const line of src.slice(start, end).split(/\r?\n/).slice(1)) {
    const c = line.match(/^\s*\/\/\s?(.*)$/);
    if (c) { comment.push(c[1].trim()); continue; }
    const k = line.match(/^\s{2}(\w+): boolean;/);
    if (k) { out.push({ key: k[1], comment: firstSentence(comment.join(" ")) }); comment = []; continue; }
    if (line.trim() === "") continue;
    comment = [];
  }
  return out;
}

function extensionFacts(root) {
  const src = readFileSync(join(root, "src", "extensions", "types.ts"), "utf8");
  const start = src.indexOf("export interface TenantExtension");
  const body = src.slice(start);
  const out = [];
  const re = /\/\*\*([\s\S]*?)\*\/\s*(\w+)\?\(/g;
  let m;
  while ((m = re.exec(body))) {
    const doc = m[1].split("\n").map((l) => l.replace(/^\s*\*\s?/, "")).join(" ");
    out.push({ name: m[2], doc: firstSentence(doc) });
  }
  return out;
}

function mcpFacts(root) {
  const j = JSON.parse(readFileSync(join(root, "mcp-server", "mcp.json"), "utf8"));
  return { version: j.version, tools: (j.tools ?? []).map((t) => ({ name: t.name, description: firstSentence(t.description ?? "") })) };
}

function capabilityDocs(root) {
  const dir = join(root, "docs", "capabilities");
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) {
    const key = f.replace(/\.md$/, "");
    const lines = readFileSync(join(dir, f), "utf8").split(/\r?\n/);
    const entry = { status: "live", plain: "", rules: [] };
    let inRules = false;
    for (const line of lines) {
      const st = line.match(/^status:\s*(\w+)\s*$/);
      const pl = line.match(/^plain:\s*(.+)$/);
      if (st) entry.status = st[1];
      else if (pl) entry.plain = pl[1].trim();
      else if (/^rules:\s*$/.test(line)) inRules = true;
      else if (inRules && /^-\s+/.test(line)) entry.rules.push(line.replace(/^-\s+/, "").trim());
    }
    out[key] = entry;
  }
  return out;
}

export function extractFacts(root = ROOT) {
  return {
    features: featureFacts(root),
    extensionHooks: extensionFacts(root),
    mcp: mcpFacts(root),
    capabilityDocs: capabilityDocs(root),
  };
}

export const serialise = (facts) => JSON.stringify(facts, null, 2) + "\n";

if (process.argv[1] && process.argv[1].endsWith("build-capability-facts.mjs")) {
  const next = serialise(extractFacts());
  if (process.argv.includes("--check")) {
    const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (cur !== next) { process.stderr.write("capability facts are stale: run node scripts/build-capability-facts.mjs\n"); process.exit(1); }
  } else {
    writeFileSync(OUT, next);
    process.stdout.write(`wrote ${OUT}\n`);
  }
}
