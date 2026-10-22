// A small, safe markdown reader for what the assistant writes (owner request 2026-10-22: the dock showed literal
// "**Size:**"). It reads text into a tree of plain nodes and never produces markup: the dock turns the nodes into React
// elements, so every character of the text is escaped by React and nothing can become HTML.
//
// Supported: **bold**, *italic*, `code`, bullet and numbered lists, headings (shown as bold lines), line breaks, fenced
// code, and [label](https://link). Anything else that looks like a marker but does not form valid markdown (an unclosed
// **, a lone `, a ~~) is removed rather than shown. Links must be https; any other target keeps only its label.

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "italic"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "p"; lines: Inline[][] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "pre"; v: string };

export type MdOptions = {
  /** Render [label](https://...) as a link. Off for text that came from the web: the sources card is its only way out. */
  links?: boolean;
};

export const MAX_MD_CHARS = 20_000;
const MAX_DEPTH = 3;
const MAX_LABEL = 200;
const MAX_URL = 2000;
// Every marker looks for its partner within this many characters, so a hostile run of unclosed markers costs a bounded
// amount each instead of a scan to the end of the text.
const MAX_SPAN = 1500;

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** https only, no credentials, nothing that could break out of an attribute. Returns the normalised URL or null. */
export function safeHttpsUrl(raw: string): string | null {
  const u = raw.trim();
  if (!u || u.length > MAX_URL || /[\s"'<>`\\]/.test(u)) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

function runLength(s: string, i: number): number {
  let n = 0;
  while (s[i + n] === s[i]) n++;
  return n;
}

/** Index of the closing run for an emphasis marker of length m opened at `from`, or -1. */
function findCloser(s: string, from: number, ch: string, m: number, none: Map<string, number>): number {
  const stop = Math.min(s.length, from + MAX_SPAN);
  const key = `${ch}${m}`;
  // A closer is a property of its own position, not of the opener, so a scan that found none up to `stop` has found
  // none for every later opener either: only the new stretch is read. Unclosed markers cost O(1) each, not O(span).
  const begin = Math.max(from, none.get(key) ?? 0);
  for (let j = begin; j < stop; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === "`") {
      const end = s.indexOf("`", j + 1);
      if (end === -1 || end >= stop) break;
      j = end;
      continue;
    }
    if (s[j] !== ch) continue;
    const r = runLength(s, j);
    if (r === m && j > from && !isSpace(s[j - 1]) && (ch === "*" || !isWord(s[j + r]))) return j;
    j += r - 1;
  }
  none.set(key, stop);
  return -1;
}

function pushText(out: Inline[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last?.t === "text") last.v += v;
  else out.push({ t: "text", v });
}

function parseInline(s: string, opts: MdOptions, depth: number): Inline[] {
  const out: Inline[] = [];
  const noCloser = new Map<string, number>();
  let buf = "";
  const flush = () => { pushText(out, buf); buf = ""; };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    if (ch === "\\" && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!~>|]/.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }

    if (ch === "`") {
      const n = runLength(s, i);
      const marker = "`".repeat(n);
      const end = s.slice(0, i + n + MAX_SPAN).indexOf(marker, i + n);
      if (end > i + n && s[end + n] !== "`") {
        flush();
        out.push({ t: "code", v: s.slice(i + n, end).trim() });
        i = end + n;
      } else i += n; // no closing backtick: the stray marker is dropped
      continue;
    }

    if (ch === "~" && s[i + 1] === "~") { i += runLength(s, i); continue; }

    if (ch === "*" || ch === "_") {
      const n = runLength(s, i);
      const prev = s[i - 1];
      const next = s[i + n];
      const m = Math.min(n, 3);
      const canOpen = n <= 3 && !isSpace(next) && (ch === "*" || !isWord(prev)) && depth < MAX_DEPTH;
      const end = canOpen ? findCloser(s, i + n, ch, n, noCloser) : -1;
      if (end !== -1) {
        flush();
        const inner = parseInline(s.slice(i + n, end), opts, depth + 1);
        out.push(m === 1 ? { t: "italic", c: inner } : m === 2 ? { t: "bold", c: inner } : { t: "bold", c: [{ t: "italic", c: inner }] });
        i = end + n;
        continue;
      }
      // Not valid markdown. A marker touching text is dropped; a lone "*" between spaces ("3 * 4") is just a character.
      // An underscore inside a word (snake_case) is a character too.
      if (prev !== undefined && next !== undefined && isSpace(prev) && isSpace(next)) buf += s.slice(i, i + n);
      else if (ch === "_" && isWord(prev) && isWord(next)) buf += s.slice(i, i + n);
      i += n;
      continue;
    }

    if (ch === "[") {
      const rel = s.slice(i + 1, i + 2 + MAX_LABEL).indexOf("](");
      const close = rel === -1 ? -1 : i + 1 + rel;
      const labelOk = close !== -1 && !s.slice(i + 1, close).includes("[");
      const urlRel = labelOk ? s.slice(close + 2, close + 3 + MAX_URL).indexOf(")") : -1;
      const end = urlRel === -1 ? -1 : close + 2 + urlRel;
      if (labelOk && end !== -1) {
        const label = s.slice(i + 1, close);
        const href = opts.links === false ? null : safeHttpsUrl(s.slice(close + 2, end));
        const inner = parseInline(label, opts, depth + 1);
        flush();
        if (href) out.push({ t: "link", href, c: inner });
        else for (const node of inner) out.push(node);
        i = end + 1;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

const BULLET = /^\s{0,8}(?:[-*+•])\s+(.+)$/;
const NUMBERED = /^\s{0,8}(\d{1,3})[.)]\s+(.+)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s{0,3}(```+|~~~+)/;

/** Reads markdown text into blocks of plain nodes. Linear in the length of the text; input beyond MAX_MD_CHARS is cut. */
export function parseMarkdown(text: string, opts: MdOptions = {}): Block[] {
  const lines = String(text ?? "").slice(0, MAX_MD_CHARS).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: Inline[][] = [];
  let list: { kind: "ul" | "ol"; start: number; items: Inline[][] } | null = null;
  let fence: string[] | null = null;

  const endPara = () => { if (para.length) blocks.push({ t: "p", lines: para }); para = []; };
  const endList = () => { if (list) blocks.push(list.kind === "ul" ? { t: "ul", items: list.items } : { t: "ol", start: list.start, items: list.items }); list = null; };
  const end = () => { endPara(); endList(); };

  for (const raw of lines) {
    if (fence) {
      if (FENCE.test(raw)) { blocks.push({ t: "pre", v: fence.join("\n") }); fence = null; } else fence.push(raw);
      continue;
    }
    if (FENCE.test(raw)) { end(); fence = []; continue; }
    if (!raw.trim()) { end(); continue; }
    if (RULE.test(raw)) { end(); continue; }

    const heading = HEADING.exec(raw);
    if (heading) {
      end();
      if (heading[1]) blocks.push({ t: "p", lines: [[{ t: "bold", c: parseInline(heading[1], opts, 1) }]] });
      continue;
    }

    const line = raw.replace(/^\s{0,3}>\s?/, "");
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      endPara();
      const kind = bullet ? "ul" : "ol";
      if (list && list.kind !== kind) endList();
      if (!list) list = { kind, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(parseInline((bullet ? bullet[1] : numbered![2]).trim(), opts, 0));
      continue;
    }

    endList();
    para.push(parseInline(line.trim(), opts, 0));
  }
  if (fence) blocks.push({ t: "pre", v: fence.join("\n") });
  end();
  return blocks;
}

/** One line of inline markdown (a label, a step), as nodes. */
export function parseInlineText(text: string, opts: MdOptions = {}): Inline[] {
  return parseInline(String(text ?? "").slice(0, MAX_MD_CHARS).replace(/\s*\n\s*/g, " ").trim(), opts, 0);
}

const flat = (nodes: Inline[]): string =>
  nodes.map((n) => (n.t === "text" || n.t === "code" ? n.v : flat(n.c))).join("");

/** The text with every marker resolved away: for a label, a title or anywhere only plain text can go. */
export function plainText(text: string): string {
  return flat(parseInlineText(text, { links: false }));
}
