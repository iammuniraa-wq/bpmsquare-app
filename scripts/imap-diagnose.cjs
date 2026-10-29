// Runs the same IMAP steps as BPMSquare's Inbox reader against one mailbox and prints which step the server refuses.
// Usage (from the repo folder):  node scripts/imap-diagnose.cjs
// It asks for the Gmail address and App Password, keeps them in memory only, and never sends or changes mail.
const readline = require("readline");
const { ImapFlow } = require("imapflow");

const HEADERS = ["in-reply-to", "references", "auto-submitted", "precedence", "x-auto-response-suppress", "x-autoreply", "x-autorespond", "x-bpmsquare-inbox", "return-path", "list-id"];

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}
function show(step, e) {
  console.log(`FAILED  ${step}`);
  console.log("  message        :", e.message);
  console.log("  responseStatus :", e.responseStatus);
  console.log("  responseText   :", e.responseText);
  console.log("  command        :", e.executedCommand);
  console.log("  serverCode     :", e.serverResponseCode);
}

(async () => {
  const user = await ask("Gmail address: ");
  const pass = await ask("App password: ");
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  client.on("error", (e) => console.log("client error event:", e.message));
  try { await client.connect(); console.log("ok      connect + login"); } catch (e) { show("connect", e); return; }
  let lock;
  try { lock = await client.getMailboxLock("INBOX"); console.log("ok      open INBOX, uidValidity", String(client.mailbox.uidValidity), "uidNext", client.mailbox.uidNext); } catch (e) { show("open INBOX", e); await client.logout().catch(() => {}); return; }
  try {
    let uidsSince = [];
    try { uidsSince = (await client.search({ since: new Date(Date.now() - 3 * 86400000) }, { uid: true })) || []; console.log("ok      search since 3 days:", uidsSince.length, "messages"); } catch (e) { show("search since", e); }
    const next = Number(client.mailbox.uidNext) - 1;
    try { const r = (await client.search({ uid: `${Math.max(1, next - 5)}:*` }, { uid: true })) || []; console.log("ok      search uid range:", r.length, "messages"); } catch (e) { show("search uid range", e); }
    const sample = uidsSince.slice(-5);
    for (const uid of sample) {
      let msg;
      try { msg = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true, headers: HEADERS }, { uid: true }); console.log(`ok      fetch uid ${uid}:`, (msg.envelope.subject || "").slice(0, 50)); } catch (e) { show(`fetch uid ${uid}`, e); continue; }
      const walk = (n, out) => { if (!n) return; if (n.childNodes) n.childNodes.forEach((c) => walk(c, out)); else out.push({ part: n.part, type: n.type, name: (n.dispositionParameters && n.dispositionParameters.filename) || (n.parameters && n.parameters.name) || "", size: n.size }); };
      const parts = []; walk(msg.bodyStructure, parts);
      for (const p of parts.slice(0, 4)) {
        try { const dl = await client.download(String(uid), p.part, { uid: true }); let n = 0; for await (const c of dl.content) n += c.length; console.log(`ok      download uid ${uid} part ${p.part} (${p.type} ${p.name}) ${n} bytes`); } catch (e) { show(`download uid ${uid} part ${p.part} (${p.type} ${p.name})`, e); }
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  console.log("done");
})().catch((e) => { console.log("unexpected:", e.message); });
