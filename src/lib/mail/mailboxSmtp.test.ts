import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";

// The host guard is a separate test; here the real nodemailer talks to a stub SMTP server on loopback.
vi.mock("@/lib/net/safeHost", () => ({ assertPublicHost: async () => {} }));
vi.mock("@/lib/connectors/server", () => ({ getDecryptedCredentials: async () => null }));

import { sendViaMailbox, type Mailbox } from "./mailbox";

type Seen = { auth: string | null; from: string | null; rcpt: string[]; data: string };

function stubSmtp(): Promise<{ server: Server; port: number; seen: Seen }> {
  const seen: Seen = { auth: null, from: null, rcpt: [], data: "" };
  const server = createServer((sock) => {
    let inData = false;
    let buf = "";
    sock.write("220 stub ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end === -1) { seen.data += buf; buf = ""; return; }
          seen.data += buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          sock.write("250 2.0.0 queued as STUB1\r\n");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO")) sock.write("250-stub\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (cmd.startsWith("AUTH PLAIN")) { seen.auth = Buffer.from(line.split(" ")[2] ?? "", "base64").toString("utf8"); sock.write("235 2.7.0 ok\r\n"); }
        else if (cmd.startsWith("MAIL FROM")) { seen.from = line; sock.write("250 ok\r\n"); }
        else if (cmd.startsWith("RCPT TO")) { seen.rcpt.push(line); sock.write("250 ok\r\n"); }
        else if (cmd === "DATA") { inData = true; sock.write("354 go\r\n"); }
        else if (cmd === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else sock.write("250 ok\r\n");
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port, seen })));
}

let srv: Awaited<ReturnType<typeof stubSmtp>>;
beforeEach(async () => { srv = await stubSmtp(); });
afterEach(async () => { await new Promise((r) => srv.server.close(() => r(null))); });

const mailbox = (port: number): Mailbox => ({
  connectorId: "mail_server", address: "buyer@example.com", user: "buyer", pass: "pw-1",
  smtp: { host: "127.0.0.1", port, secure: false }, imap: { host: "127.0.0.1", port: 993, secure: true },
});

describe("sendViaMailbox through the installed nodemailer", () => {
  it("logs in, sends with threading headers and an attachment, and returns the message id", async () => {
    const r = await sendViaMailbox(mailbox(srv.port), {
      fromName: "Acme Buyer", to: ["supplier@example.org"], subject: "RFQ-0001 request", text: "Please quote.", html: "<p>Please quote.</p>",
      replyTo: "reply@example.com", messageId: "<rfq-1@example.com>", inReplyTo: "<prev@example.org>", references: "<prev@example.org>",
      attachments: [{ filename: "spec.txt", content: Buffer.from("spec"), contentType: "text/plain" }],
    });
    expect(r).toEqual({ ok: true, messageId: "<rfq-1@example.com>" });
    expect(srv.seen.auth).toBe("\u0000buyer\u0000pw-1");
    expect(srv.seen.from).toContain("buyer@example.com");
    expect(srv.seen.rcpt.join(" ")).toContain("supplier@example.org");
    expect(srv.seen.data).toMatch(/In-Reply-To: <prev@example.org>/i);
    expect(srv.seen.data).toMatch(/References: <prev@example.org>/i);
    expect(srv.seen.data).toMatch(/Subject: RFQ-0001 request/i);
    expect(srv.seen.data).toMatch(/filename="?spec\.txt"?/i);
  });

  it("reports a refused connection as an error, not a throw", async () => {
    const port = srv.port;
    await new Promise((r) => srv.server.close(() => r(null)));
    const r = await sendViaMailbox(mailbox(port), { fromName: "A", to: ["x@example.org"], subject: "s", text: "t" });
    expect(r.ok).toBe(false);
    srv = await stubSmtp();
  });
});
