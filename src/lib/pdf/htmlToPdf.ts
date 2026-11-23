import "server-only";
import { allowHostsRule, renderPdf } from "./renderPdf";

// HTML string -> PDF, through the one renderer (renderPdf). For documents built server-side from data we already
// hold -- no page navigation, no session cookie, so it also works where there is no logged-in request (a cron, an
// inbound webhook). The HTML must be fully escaped by its builder; nothing loads except data: URIs and https from the
// hosts named in `allowHosts` (the storage host the workspace's logo lives on).

export async function htmlToPdf(html: string, opts: { timeoutMs?: number; allowHosts?: string[] } = {}): Promise<Buffer> {
  return renderPdf({
    source: { kind: "html", html, timeoutMs: opts.timeoutMs ?? 20_000 },
    margin: { top: "14mm", bottom: "14mm", left: "15mm", right: "15mm" },
    settle: false,
    allowRequest: allowHostsRule(opts.allowHosts ?? []),
  });
}
