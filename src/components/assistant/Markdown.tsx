import { Fragment, type ReactNode } from "react";
import { parseInlineText, parseMarkdown, type Block, type Inline, type MdOptions } from "@/lib/assistant/markdown";

// Draws the tree from lib/assistant/markdown.ts. Everything is built as React elements from plain strings, so the text is
// escaped by React and no markup of the model's can reach the page; there is no raw-HTML path here.

function nodes(list: Inline[], keyPrefix = ""): ReactNode[] {
  return list.map((n, i) => {
    const key = `${keyPrefix}${i}`;
    switch (n.t) {
      case "text": return <Fragment key={key}>{n.v}</Fragment>;
      case "bold": return <strong key={key}>{nodes(n.c, `${key}.`)}</strong>;
      case "italic": return <em key={key}>{nodes(n.c, `${key}.`)}</em>;
      case "code": return <code key={key} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.92em", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 4, padding: "0 4px" }}>{n.v}</code>;
      case "link": return <a key={key} href={n.href} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", fontWeight: 650, textDecoration: "underline", overflowWrap: "anywhere" }}>{nodes(n.c, `${key}.`)}</a>;
    }
  });
}

function block(b: Block, i: number): ReactNode {
  switch (b.t) {
    case "p":
      return (
        <p key={i} style={{ margin: 0 }}>
          {b.lines.map((line, k) => <Fragment key={k}>{k > 0 && <br />}{nodes(line)}</Fragment>)}
        </p>
      );
    case "ul":
      return <ul key={i} style={{ margin: 0, paddingLeft: 18 }}>{b.items.map((it, k) => <li key={k}>{nodes(it)}</li>)}</ul>;
    case "ol":
      return <ol key={i} start={b.start} style={{ margin: 0, paddingLeft: 20 }}>{b.items.map((it, k) => <li key={k}>{nodes(it)}</li>)}</ol>;
    case "pre":
      return <pre key={i} style={{ margin: 0, padding: "6px 8px", overflowX: "auto", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, fontSize: "0.92em", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><code>{b.v}</code></pre>;
  }
}

/** A message or paragraph of text: markers resolved, lists and line breaks kept. */
export function Markdown({ text, links = true }: { text: string } & MdOptions) {
  const blocks = parseMarkdown(text, { links });
  return <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowWrap: "anywhere" }}>{blocks.map(block)}</div>;
}

/** One line of text (a step, a note) with its markers resolved; no wrapper element. */
export function InlineMarkdown({ text, links = false }: { text: string } & MdOptions) {
  return <>{nodes(parseInlineText(text, { links }))}</>;
}
