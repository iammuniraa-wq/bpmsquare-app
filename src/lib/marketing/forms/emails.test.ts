import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));

import { fakeDb, type Row } from "../testFakeDb";
import { canContact } from "../consent";
import { signRenderToken } from "./guards";
import { handleSubmission, type SubmitDeps } from "./submit";
import { buildNotice, buildThankYou, type FormMailer } from "./emails";
import { confirmPendingConsent } from "./confirm";
import { verifyConfirmToken } from "./confirmToken";
import { tipTextProblems } from "@/lib/infoTip";
import { FORM_TIPS } from "./tips";
import { defaultAfterSubmit, defaultFields, defaultThankYouText } from "./types";
import { normaliseAfter, sanitizeFormSave } from "./sanitize";

const T1 = "11111111-1111-4111-8111-111111111111";
const F1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY1 = "frm_AAAAAAAAAAAAAAAAAAAAAAAA";
const OWNER = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const STRANGER = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { s: process.env.QUOTE_PUBLIC_LINK_SECRET, k: process.env.FIELD_ENCRYPTION_KEY };
  process.env.QUOTE_PUBLIC_LINK_SECRET = "test-secret";
  process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);
  vi.spyOn(Math, "random").mockReturnValue(0.99);
});
afterEach(() => {
  process.env.QUOTE_PUBLIC_LINK_SECRET = saved.s;
  process.env.FIELD_ENCRYPTION_KEY = saved.k;
  vi.restoreAllMocks();
});

type Sent = { from: string; to: string[]; subject: string; text: string; html?: string; replyTo?: string };
const mailbox = () => {
  const sent: Sent[] = [];
  const mailer: FormMailer = { emails: { send: async (p) => { sent.push(p); return { error: null }; } } };
  return { sent, mailer };
};

const topics = [{ key: "offers", label: "Offers", hint: "" }, { key: "events", label: "Events", hint: "" }];
const tenant = (over: Row = {}): Row => ({
  id: T1, name: "Al Noor", slug: "alnoor", custom_domain: "crm.alnoor.test", is_demo: false, company_info: { email: "hello@alnoor.test" },
  features: { marketing: true, marketing_forms: true }, config: { marketing: { topics } }, ...over,
});
const form = (after: Row = {}): Row => ({
  id: F1, tenant_id: T1, ref: "FRM-0001", name: "Website contact", slug: "contact", public_key: KEY1, status: "live",
  fields: defaultFields(), consent: { text: "I agree to hear about offers by email.", topics: ["offers"], required: false },
  after_submit: { ...defaultAfterSubmit(), ...after }, updated_at: "2026-10-20T08:00:00.000Z",
});
const seed = (t: Row = tenant(), after: Row = {}, extra: Record<string, Row[]> = {}) => fakeDb({
  tenants: [t], forms: [form(after)], accounts: [], contacts: [], leads: [], form_submissions: [], consent_events: [], consent_state: [], domain_event: [],
  tenant_users: [{ tenant_id: T1, user_id: OWNER }], email_log: [], suppressions: [],
  ...extra,
});
const good = (over: Record<string, unknown> = {}) => ({
  name: "Ali Hassan", company: "Gulf Precast", email: "Ali@Gulf.test", message: "Need a quote", consent: true,
  rt: signRenderToken(KEY1, Date.now() - 10_000), company_website: "", ...over,
});
const send = (db: ReturnType<typeof fakeDb>, deps: SubmitDeps, body: unknown = good()) =>
  handleSubmission(db.client, { key: KEY1, rawBody: JSON.stringify(body), ipHash: null, uaFamily: "Chrome" }, deps);
const withOwner = (db: ReturnType<typeof fakeDb>) => {
  (db.client as unknown as { auth: unknown }).auth = { admin: { getUserById: async (id: string) => ({ data: { user: id === OWNER ? { email: "owner@alnoor.test" } : null } }) } };
};

describe("the thank-you email", () => {
  it("goes to the visitor with the form's own words and the workspace's reply address", async () => {
    const db = seed(tenant(), { thank_you_text: "Thanks for asking about precast. We reply within a day." });
    const m = mailbox();
    const r = await send(db, { mailer: m.mailer });
    expect(r.status).toBe(200);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0].to).toEqual(["ali@gulf.test"]);
    expect(m.sent[0].from).toBe("Al Noor <alnoor@bpmsquare.com>");
    expect(m.sent[0].replyTo).toBe("hello@alnoor.test");
    expect(m.sent[0].text).toContain("Hello Ali,");
    expect(m.sent[0].text).toContain("Thanks for asking about precast. We reply within a day.");
    expect(db.tables.email_log).toHaveLength(1);
    expect(db.tables.email_log[0]).toMatchObject({ tenant_id: T1, status: "sent", related_object_type: "forms", related_object_id: F1 });
  });

  it("is sent even when the box was not ticked: it confirms their own submission, it is not marketing", async () => {
    const db = seed();
    const m = mailbox();
    await send(db, { mailer: m.mailer }, good({ consent: false }));
    expect(m.sent).toHaveLength(1);
    expect(db.tables.consent_events).toHaveLength(0);
    expect(m.sent[0].text).not.toContain("/marketing/confirm/");
  });

  it("can be switched off", async () => {
    const db = seed(tenant(), { thank_you_email: false });
    const m = mailbox();
    await send(db, { mailer: m.mailer });
    expect(m.sent).toHaveLength(0);
  });

  it("is plain text in the html: a hostile name cannot add markup", async () => {
    const db = seed();
    const m = mailbox();
    await send(db, { mailer: m.mailer }, good({ name: '<img src=x onerror=alert(1)> "Eve"' }));
    expect(m.sent[0].html).not.toMatch(/<img/i);
    expect(buildThankYou({ brand: "A&B", firstName: "<b>x</b>", words: "a <script>alert(1)</script>", link: null, confirmTopics: [] }).html).not.toMatch(/<script|<b>/);
  });

  it("is not sent twice to the same person within the hour", async () => {
    const db = seed();
    const m = mailbox();
    await send(db, { mailer: m.mailer }, good({ rt: signRenderToken(KEY1, Date.now() - 10_000) }));
    await send(db, { mailer: m.mailer }, good({ rt: signRenderToken(KEY1, Date.now() - 10_000) }));
    expect(m.sent).toHaveLength(1);
  });

  it("never breaks the submission when the mail service fails", async () => {
    const db = seed();
    const failing: FormMailer = { emails: { send: async () => { throw new Error("service down"); } } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await send(db, { mailer: failing });
    expect(r.status).toBe(200);
    expect(db.tables.form_submissions).toHaveLength(1);
    expect(db.tables.email_log[0]).toMatchObject({ status: "failed" });
  });

  it("is simply not sent when no mail service is configured", async () => {
    const db = seed();
    const r = await send(db, { mailer: null });
    expect(r.status).toBe(200);
    expect(db.tables.email_log).toHaveLength(0);
  });
});

describe("nothing leaves a demo workspace", () => {
  it("is redirected to the one internal inbox, with the intended person named, never sent to the visitor", async () => {
    const db = seed(tenant({ is_demo: true, config: { marketing: { topics }, email_output: { mode: "redirect", redirect_to: "inbox@bpm.test" } } }));
    const m = mailbox();
    await send(db, { mailer: m.mailer });
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0].to).toEqual(["inbox@bpm.test"]);
    expect(m.sent[0].subject).toContain("ali@gulf.test");
    expect(m.sent.flatMap((x) => x.to)).not.toContain("ali@gulf.test");
  });

  it("sends nothing at all when the demo workspace has no inbox set", async () => {
    const db = seed(tenant({ is_demo: true }), { notify_owner: true, notify_user_id: OWNER });
    withOwner(db);
    const m = mailbox();
    const r = await send(db, { mailer: m.mailer });
    expect(r.status).toBe(200);
    expect(m.sent).toHaveLength(0);
  });

  it("holds for the owner notice too", async () => {
    const db = seed(tenant({ is_demo: true, config: { marketing: { topics }, email_output: { mode: "redirect", redirect_to: "inbox@bpm.test" } } }), { notify_owner: true, notify_user_id: OWNER });
    withOwner(db);
    const m = mailbox();
    await send(db, { mailer: m.mailer });
    expect(m.sent.flatMap((x) => x.to)).toEqual(["inbox@bpm.test", "inbox@bpm.test"]);
  });
});

describe("the owner notice", () => {
  it("is sent only when the form names a person, and goes to that person", async () => {
    const off = seed();
    withOwner(off);
    const m1 = mailbox();
    await send(off, { mailer: m1.mailer });
    expect(m1.sent.map((x) => x.to[0])).toEqual(["ali@gulf.test"]);

    const on = seed(tenant(), { notify_owner: true, notify_user_id: OWNER });
    withOwner(on);
    const m2 = mailbox();
    await send(on, { mailer: m2.mailer });
    expect(m2.sent.map((x) => x.to[0]).sort()).toEqual(["ali@gulf.test", "owner@alnoor.test"]);
    const notice = m2.sent.find((x) => x.to[0] === "owner@alnoor.test")!;
    expect(notice.subject).toBe("New answer on Website contact");
    expect(notice.text).toContain("Need a quote");
    expect(notice.text).toContain("ali@gulf.test");
  });

  it("is not sent when the named person has left the workspace", async () => {
    const db = seed(tenant(), { notify_owner: true, notify_user_id: STRANGER });
    withOwner(db);
    const m = mailbox();
    await send(db, { mailer: m.mailer });
    expect(m.sent.map((x) => x.to[0])).toEqual(["ali@gulf.test"]);
  });

  it("escapes what the visitor wrote", () => {
    const n = buildNotice({ brand: "X", formName: "F <b>", values: { message: "<script>alert(1)</script>", email: "a@b.test" } });
    expect(n.html).not.toContain("<script");
    expect(n.html).toContain("F &lt;b&gt;");
  });
});

describe("double opt-in", () => {
  const eu = () => tenant({ config: { marketing: { topics, consent: { jurisdiction: "EU" } } } });
  const linkOf = (s: Sent) => /https:\/\/[^\s]+\/marketing\/confirm\/[^\s]+/.exec(s.text)![0];
  const partsOf = (url: string) => { const [, , , , , contactId, token] = url.split("/"); return { contactId, token }; };

  it("is on by default for a workspace in the EU and off elsewhere, and a form's own choice wins", async () => {
    const m1 = mailbox();
    const db1 = seed(eu());
    await send(db1, { mailer: m1.mailer });
    expect(db1.tables.consent_events[0].status).toBe("pending");

    const db2 = seed(tenant());
    await send(db2, { mailer: mailbox().mailer });
    expect(db2.tables.consent_events[0].status).toBe("granted");

    const db3 = seed(eu(), { confirm_by_email: false });
    await send(db3, { mailer: mailbox().mailer });
    expect(db3.tables.consent_events[0].status).toBe("granted");

    const db4 = seed(tenant(), { confirm_by_email: true });
    await send(db4, { mailer: mailbox().mailer });
    expect(db4.tables.consent_events[0].status).toBe("pending");
  });

  it("records the tick as pending, counts it as nothing, and puts a signed link in the thank-you email", async () => {
    const db = seed(eu());
    const m = mailbox();
    const r = await send(db, { mailer: m.mailer });
    expect(r.status).toBe(200);
    expect(db.tables.consent_state).toHaveLength(0);
    expect(db.tables.domain_event.filter((e) => String(e.name).startsWith("consent."))).toHaveLength(0);
    const contactId = String(db.tables.contacts[0].id);
    expect((await canContact(T1, contactId, "email", "offers", db.client)).ok).toBe(false);
    expect(db.tables.consent_events[0].evidence).toMatchObject({ double_opt_in: true, form_id: F1, text: "I agree to hear about offers by email." });

    const url = linkOf(m.sent[0]);
    expect(url).toMatch(/^https:\/\/crm\.alnoor\.test\/marketing\/confirm\//);
    expect(m.sent[0].html).toContain("Yes, confirm my email");
    expect(m.sent[0].text).toContain("about Offers");
    expect(partsOf(url).contactId).toBe(contactId);
    expect(verifyConfirmToken(contactId, partsOf(url).token).ok).toBe(true);
  });

  it("pressing the link makes it a yes: pending to granted, with the event", async () => {
    const db = seed(eu());
    const m = mailbox();
    await send(db, { mailer: m.mailer });
    const { contactId, token } = partsOf(linkOf(m.sent[0]));
    const check = verifyConfirmToken(contactId, token);
    if (!check.ok) throw new Error("link should be valid");
    const r = await confirmPendingConsent(db.client, T1, contactId, check.windowStart, { ipHash: null, uaFamily: "Safari" });
    expect(r).toEqual({ ok: true, confirmed: 1 });
    expect(db.tables.consent_state[0]).toMatchObject({ topic: "offers", status: "granted" });
    expect(db.tables.domain_event.map((e) => e.name)).toContain("consent.confirmed");
    expect((await canContact(T1, contactId, "email", "offers", db.client)).ok).toBe(true);
  });

  it("an expired link is refused and the answer stays pending", async () => {
    const db = seed(eu());
    const m = mailbox();
    await send(db, { mailer: m.mailer });
    const { contactId, token } = partsOf(linkOf(m.sent[0]));
    expect(verifyConfirmToken(contactId, token, Date.now() + 8 * 86_400_000)).toEqual({ ok: false, reason: "expired" });
    expect(db.tables.consent_state).toHaveLength(0);
    expect((await canContact(T1, contactId, "email", "offers", db.client)).ok).toBe(false);
  });

  it("still sends the link when the thank-you words are switched off", async () => {
    const db = seed(eu(), { thank_you_email: false });
    const m = mailbox();
    await send(db, { mailer: m.mailer });
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0].subject).toContain("Please confirm");
    expect(m.sent[0].text).toContain("/marketing/confirm/");
  });

  it("without the signing secret it records no consent at all rather than a yes nobody gave", async () => {
    delete process.env.QUOTE_PUBLIC_LINK_SECRET;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = seed(eu());
    const r = await send(db, { mailer: mailbox().mailer });
    expect(r.status).toBe(200);
    expect(db.tables.consent_events).toHaveLength(0);
    expect(db.tables.consent_state).toHaveLength(0);
  });

  it("while migration 0197 is pending the form still works and records no consent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = seed(eu());
    const real = db.client.from.bind(db.client);
    (db.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = real(t) as { insert: (r: unknown) => unknown };
      if (t === "consent_events") q.insert = () => Promise.resolve({ data: null, error: { code: "23514", message: "violates check constraint" } });
      return q;
    };
    const m = mailbox();
    const r = await send(db, { mailer: m.mailer });
    expect(r.status).toBe(200);
    expect(db.tables.consent_state).toHaveLength(0);
    expect(m.sent[0].text).not.toContain("/marketing/confirm/");
  });
});

describe("the settings a form stores", () => {
  const ctx = { topicKeys: ["offers"], redirectHosts: ["crm.alnoor.test"] };
  const save = (after: Record<string, unknown>) => sanitizeFormSave({ name: "F", consent: { text: "ok", topics: [], required: false }, after_submit: after }, ctx, "Al Noor");

  it("defaults: thank-you on with default words, no notice, confirmation follows the workspace", () => {
    const a = normaliseAfter({ kind: "message", message: "Hi" });
    expect(a).toMatchObject({ thank_you_email: true, thank_you_text: defaultThankYouText(), notify_owner: false, notify_user_id: null, confirm_by_email: null });
  });
  it("keeps the person only with a valid id, and refuses a notice with nobody chosen", () => {
    const ok = save({ notify_owner: true, notify_user_id: OWNER });
    expect(ok.ok && ok.value.after_submit).toMatchObject({ notify_owner: true, notify_user_id: OWNER });
    expect(save({ notify_owner: true }).ok).toBe(false);
    expect(save({ notify_owner: true, notify_user_id: "not-an-id" }).ok).toBe(false);
  });
  it("strips markup from the thank-you words and keeps the tri-state confirmation", () => {
    const r = save({ thank_you_text: "Thanks <b>so</b> much", confirm_by_email: true });
    expect(r.ok && r.value.after_submit.thank_you_text).toBe("Thanks so much");
    expect(r.ok && r.value.after_submit.confirm_by_email).toBe(true);
    const n = save({ confirm_by_email: "yes" });
    expect(n.ok && n.value.after_submit.confirm_by_email).toBeNull();
  });
});

describe("the explanations behind the i", () => {
  it("fit the InfoTip limit", () => {
    for (const [key, text] of Object.entries(FORM_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});
