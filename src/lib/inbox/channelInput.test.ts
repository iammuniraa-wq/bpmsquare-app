import { describe, expect, it } from "vitest";
import { parseChannelInput } from "./channelInput";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("a channel form", () => {
  it("a new channel needs a name; everything else has a default", () => {
    expect(parseChannelInput({}, { create: true })).toEqual({ ok: false, error: "Give the channel a name." });
    expect(parseChannelInput({ name: "  " }, { create: true })).toMatchObject({ ok: false });
    expect(parseChannelInput({ name: " Fence enquiries " }, { create: true })).toEqual({ ok: true, values: { name: "Fence enquiries" }, rotate: false });
  });
  it("accepts the whole form and nothing it does not know", () => {
    const r = parseChannelInput({
      name: "Tiles", role_ids: [UUID, UUID], default_action: "estimate", default_template_id: UUID, reply_from: " Sales@Gulf.Test ", reply_name: "Gulf Sales",
      connector_id: "gmail", active: false, tenant_id: "evil", address_alias: "inbox-hijacked", id: "x",
    }, { create: false });
    expect(r).toEqual({
      ok: true, rotate: false,
      values: { name: "Tiles", role_ids: [UUID], default_action: "estimate", default_template_id: UUID, reply_from: "sales@gulf.test", reply_name: "Gulf Sales", connector_id: "gmail", active: false },
    });
  });
  it("a PATCH may leave things out; rotating the address is its own explicit flag", () => {
    expect(parseChannelInput({ active: true }, { create: false })).toEqual({ ok: true, values: { active: true }, rotate: false });
    expect(parseChannelInput({ rotate_alias: true }, { create: false })).toEqual({ ok: true, values: {}, rotate: true });
    expect(parseChannelInput({ rotate_alias: "yes" }, { create: false })).toEqual({ ok: true, values: {}, rotate: false });
  });
  it.each([
    [{ role_ids: ["not-a-uuid"] }, /team/i],
    [{ role_ids: "all" }, /team/i],
    [{ default_action: "delete_everything" }, /Create offers/i],
    [{ default_template_id: "x" }, /template/i],
    [{ reply_from: "not an email" }, /email address/i],
    [{ reply_name: "x".repeat(121) }, /120/],
    [{ connector_id: "pop3" }, /Gmail or Mail server/],
    [{ active: "yes" }, /active/],
    [{ name: "x".repeat(81) }, /80/],
  ])("rejects %j", (body, message) => {
    const r = parseChannelInput(body, { create: false });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(message);
  });
  it("clears optional values with an empty string or null", () => {
    expect(parseChannelInput({ default_template_id: "", reply_from: "", reply_name: null, connector_id: null }, { create: false })).toEqual({
      ok: true, rotate: false, values: { default_template_id: null, reply_from: null, reply_name: null, connector_id: null },
    });
  });
  it("is not fooled by a non-object body", () => {
    for (const b of [null, "x", 5, [], undefined]) expect(parseChannelInput(b, { create: true })).toEqual({ ok: false, error: "Bad request" });
  });
});


describe("channel filter input", () => {
  it("accepts the sender and subject filters as typed text or lists and cleans them", () => {
    const r = parseChannelInput({ filter_senders: "@Ministry.gov.sa, Buyer@x.com", filter_subjects: ["Tender", "rfq", "tender"] }, { create: false });
    expect(r).toMatchObject({ ok: true, values: { filter_senders: ["@ministry.gov.sa", "buyer@x.com"], filter_subjects: ["tender", "rfq"] } });
  });
  it("leaves the filters alone when they are not sent, and empties them when sent blank", () => {
    expect(parseChannelInput({ name: "A" }, { create: false })).toMatchObject({ ok: true, values: { name: "A" } });
    const r = parseChannelInput({ filter_senders: "" }, { create: false });
    expect(r.ok && r.values).toEqual({ filter_senders: [] });
  });
});
