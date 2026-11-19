// The HTML twin of a plain-text notification. Plain text alone left links to the mercy of the reader's mail client: Outlook
// does not always make a bare URL clickable, and quoted-printable wraps a long one mid-address (KAMCO demo, 2026-11-19, the
// approval e-mails' "Review and decide" link "was not working"). So every such e-mail also carries this HTML part: the text
// escaped, a "Label: https://..." line drawn as a button, and any other URL as a real link. The text part is still sent.

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const ACTION_LINE = /^([^:\n]{1,60}):\s+(https?:\/\/[^\s<>"']+)$/;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A URL is used as an href only when it is plain http(s); anything else stays text. */
const safeHref = (u: string) => (/^https?:\/\/[^\s<>"']+$/.test(u) ? esc(u) : null);

function linkify(line: string): string {
  let out = "";
  let last = 0;
  for (const m of line.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:)\]]+$/, "");
    const at = m.index ?? 0;
    out += esc(line.slice(last, at));
    const href = safeHref(url);
    out += href ? `<a href="${href}" style="color:#1f4e8c;">${esc(url)}</a>` : esc(url);
    last = at + url.length;
  }
  return out + esc(line.slice(last));
}

function button(label: string, url: string): string {
  const href = safeHref(url);
  if (!href) return `<p>${esc(label)}: ${esc(url)}</p>`;
  return `<p style="margin:18px 0 6px;"><a href="${href}" style="display:inline-block;padding:10px 18px;background:#1f4e8c;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">${esc(label)}</a></p>`
    + `<p style="margin:0 0 14px;color:#6b7280;font-size:12px;">Or open: <a href="${href}" style="color:#6b7280;">${esc(url)}</a></p>`;
}

export function plainTextToHtml(text: string): string {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const parts: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length === 1 && lines[0].trim() === "---") { parts.push(`<hr style="border:0;border-top:1px solid #e5e7eb;margin:14px 0;">`); continue; }
    if (/^Redirected by /.test(lines[0])) { parts.push(`<p style="color:#6b7280;font-size:12px;">${lines.map(linkify).join("<br>")}</p>`); continue; }
    let para: string[] = [];
    const flush = () => { if (para.length) { parts.push(`<p style="margin:0 0 10px;">${para.join("<br>")}</p>`); para = []; } };
    for (const raw of lines) {
      const line = raw.trimEnd();
      const action = ACTION_LINE.exec(line.trim());
      const bare = /^https?:\/\/[^\s<>"']+$/.test(line.trim()) ? line.trim() : null;
      if (action) { flush(); parts.push(button(action[1].trim(), action[2])); }
      else if (bare) { flush(); parts.push(button("Open in BPMSquare", bare)); }
      else para.push(linkify(line));
    }
    flush();
  }
  return `<div style="font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937;max-width:640px;">${parts.join("\n")}</div>`;
}
