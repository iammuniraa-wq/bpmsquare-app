import { UNSAFE_KEYS } from "./types";

// A small, safe reader for the YAML an OpenAPI file is written in (spec section 2: "YAML parsed with a safe loader, no
// custom tags"). It reads maps, lists, quoted and plain scalars, one-line flow lists and maps, and `|` / `>` text blocks.
// It REFUSES anchors, aliases, merge keys, tags and a second document: those are how YAML bombs and object-construction
// tricks are written, and an API description does not need them. Pure.

export class YamlError extends Error {}

type Line = { indent: number; text: string; no: number };

const MAX_LINES = 200_000;
const MAX_DEPTH = 40;
const MAX_STRING = 200_000;

function stripComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === "\\" && q === '"') i++;
      else if (ch === q) {
        if (q === "'" && s[i + 1] === "'") i++;
        else q = null;
      }
    } else if (ch === '"' || ch === "'") {
      if (i === 0 || /[\s[{,:-]/.test(s[i - 1])) q = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

function lexLines(src: string): Line[] {
  const raw = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  if (raw.length > MAX_LINES) throw new YamlError("The file has too many lines.");
  const out: Line[] = [];
  let docs = 0;
  raw.forEach((l, i) => {
    if (/^---(\s|$)/.test(l)) { if (++docs > 1 || out.length) throw new YamlError("Only one YAML document is supported."); return; }
    if (/^\.\.\.\s*$/.test(l)) return;
    if (/\t/.test(l.match(/^\s*/)?.[0] ?? "")) throw new YamlError(`Line ${i + 1} is indented with a tab.`);
    out.push({ indent: l.length - l.trimStart().length, text: l, no: i + 1 });
  });
  return out;
}

const bodyOf = (l: Line) => stripComment(l.text).trim();

function findColon(s: string): number {
  let q: string | null = null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === "\\" && q === '"') i++;
      else if (ch === q) {
        if (q === "'" && s[i + 1] === "'") i++;
        else q = null;
      }
      continue;
    }
    if ((ch === '"' || ch === "'") && (i === 0 || /[\s[{,]/.test(s[i - 1]))) q = ch;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    else if (ch === ":" && depth === 0 && (i === s.length - 1 || s[i + 1] === " ")) return i;
  }
  return -1;
}

function unquote(s: string): string {
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new YamlError("A quoted text is not closed.");
    return s.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_m, c: string) => {
      if (c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
      return ({ n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", 0: "\0" } as Record<string, string>)[c] ?? c;
    });
  }
  if (!s.endsWith("'") || s.length < 2) throw new YamlError("A quoted text is not closed.");
  return s.slice(1, -1).replace(/''/g, "'");
}

function scalar(s: string): unknown {
  const t = s.trim();
  if (t === "") return null;
  if (t.length > MAX_STRING) throw new YamlError("A value is too long.");
  if (t[0] === '"' || t[0] === "'") return unquote(t);
  if (/^[&*!]/.test(t) || t === "<<") throw new YamlError("YAML anchors, aliases and tags are not supported.");
  if (t[0] === "[" || t[0] === "{") return flow(t);
  if (t === "~" || /^null$/i.test(t)) return null;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if (/^[-+]?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

function splitTop(s: string): string[] {
  const parts: string[] = [];
  let q: string | null = null;
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === "\\" && q === '"') { cur += s[++i] ?? ""; continue; }
      if (ch === q) { if (q === "'" && s[i + 1] === "'") { cur += s[++i]; continue; } q = null; }
      continue;
    }
    if ((ch === '"' || ch === "'") && (cur.trim() === "" || /[\s[{,:]/.test(s[i - 1] ?? ""))) { q = ch; cur += ch; continue; }
    if (ch === "[" || ch === "{") depth++;
    if (ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts;
}

function flow(t: string, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new YamlError("The file is nested too deeply.");
  const open = t[0];
  const close = open === "[" ? "]" : "}";
  if (!t.endsWith(close)) throw new YamlError("A list or map on one line is not closed (multi-line flow style is not supported).");
  const inner = t.slice(1, -1).trim();
  if (open === "[") return inner === "" ? [] : splitTop(inner).map((p) => (p.trim()[0] === "[" || p.trim()[0] === "{" ? flow(p.trim(), depth + 1) : scalar(p)));
  const out: Record<string, unknown> = {};
  if (inner === "") return out;
  for (const p of splitTop(inner)) {
    const i = findColon(p.trim().endsWith(":") ? `${p.trim()} ` : p.trim());
    const s = p.trim();
    if (i < 0) throw new YamlError("A map entry needs a name and a value.");
    const key = String(scalar(s.slice(0, i)));
    if (UNSAFE_KEYS.has(key)) throw new YamlError(`The name "${key}" is not allowed.`);
    const v = s.slice(i + 1).trim();
    out[key] = v[0] === "[" || v[0] === "{" ? flow(v, depth + 1) : scalar(v);
  }
  return out;
}

class Reader {
  i = 0;
  constructor(private lines: Line[]) {}

  peek(): Line | undefined { return this.lines[this.i]; }

  skipBlank() { while (this.i < this.lines.length && bodyOf(this.lines[this.i]) === "") this.i++; }

  parseNode(indent: number, depth: number): unknown {
    if (depth > MAX_DEPTH) throw new YamlError("The file is nested too deeply.");
    this.skipBlank();
    const l = this.peek();
    if (!l || l.indent < indent) return null;
    const b = bodyOf(l);
    if (b === "-" || b.startsWith("- ")) return this.parseSeq(l.indent, depth);
    if (findColon(b) >= 0) return this.parseMap(l.indent, depth);
    this.i++;
    return scalar(b);
  }

  parseSeq(indent: number, depth: number): unknown[] {
    const out: unknown[] = [];
    for (;;) {
      this.skipBlank();
      const l = this.peek();
      if (!l || l.indent !== indent) break;
      const b = bodyOf(l);
      if (!(b === "-" || b.startsWith("- "))) break;
      const rest = b === "-" ? "" : b.slice(2).trim();
      if (rest === "") {
        this.i++;
        out.push(this.parseNode(indent + 1, depth + 1));
      } else if (findColon(rest) >= 0 && !/^["'[{]/.test(rest)) {
        // `- key: value`: the item is a map whose keys line up with the text after the dash.
        const offset = l.text.indexOf(rest, l.indent + 1);
        this.lines[this.i] = { ...l, indent: offset, text: " ".repeat(offset) + rest };
        out.push(this.parseMap(offset, depth + 1));
      } else {
        this.i++;
        out.push(this.valueFrom(rest, indent, depth + 1));
      }
    }
    return out;
  }

  parseMap(indent: number, depth: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (;;) {
      this.skipBlank();
      const l = this.peek();
      if (!l || l.indent !== indent) break;
      const b = bodyOf(l);
      if (b === "-" || b.startsWith("- ")) break;
      const c = findColon(b);
      if (c < 0) throw new YamlError(`Line ${l.no} is not a "name: value" line.`);
      const rawKey = b.slice(0, c).trim();
      if (rawKey === "<<") throw new YamlError("YAML merge keys are not supported.");
      const key = String(scalar(rawKey));
      if (UNSAFE_KEYS.has(key)) throw new YamlError(`The name "${key}" is not allowed.`);
      const rest = b.slice(c + 1).trim();
      this.i++;
      if (rest === "") {
        // The value is nested deeper, or a list written at the same indent as its name.
        this.skipBlank();
        const n = this.peek();
        if (n && n.indent > indent) out[key] = this.parseNode(n.indent, depth + 1);
        else if (n && n.indent === indent && (bodyOf(n) === "-" || bodyOf(n).startsWith("- "))) out[key] = this.parseSeq(indent, depth + 1);
        else out[key] = null;
      } else out[key] = this.valueFrom(rest, indent, depth + 1);
    }
    return out;
  }

  /** The value written after a name or a dash: a text block, a one-line flow value or a scalar. */
  valueFrom(rest: string, indent: number, depth: number): unknown {
    if (/^[|>][+-]?\d?$/.test(rest)) return this.blockText(indent, rest[0] === ">");
    return scalar(rest);
  }

  blockText(parentIndent: number, folded: boolean): string {
    const rows: string[] = [];
    let base = -1;
    while (this.i < this.lines.length) {
      const l = this.lines[this.i];
      const blank = l.text.trim() === "";
      if (!blank && l.indent <= parentIndent) break;
      if (!blank && base < 0) base = l.indent;
      rows.push(blank ? "" : l.text.slice(Math.min(base, l.indent)));
      this.i++;
      if (rows.join("\n").length > MAX_STRING) throw new YamlError("A text block is too long.");
    }
    while (rows.length && rows[rows.length - 1] === "") rows.pop();
    return folded ? rows.join(" ").replace(/\s+/g, " ").trim() : rows.join("\n");
  }
}

export function parseYaml(src: string): unknown {
  const lines = lexLines(src);
  if (!lines.some((l) => bodyOf(l) !== "")) return null;
  const r = new Reader(lines);
  r.skipBlank();
  const first = r.peek();
  const v = r.parseNode(first ? first.indent : 0, 0);
  r.skipBlank();
  if (r.peek()) throw new YamlError(`Line ${r.peek()!.no} could not be read.`);
  return v;
}
