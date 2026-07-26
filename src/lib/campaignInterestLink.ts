import crypto from "crypto";

// Signed, stateless "I'm interested" click-through link -- same trust model
// as lib/marketingUnsubscribe.ts (the link itself is the credential, no
// login). Lets a campaign recipient signal interest without any account
// system access; the response is what turns into an attributed Lead. No
// expiry, same reasoning as unsubscribe: a genuine campaign email should
// stay actionable for as long as the recipient keeps it.
function secret(): string | null {
  return process.env.QUOTE_PUBLIC_LINK_SECRET || null;
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function signCampaignInterestToken(campaignId: string, accountId: string): string | null {
  const key = secret();
  if (!key) return null;
  return sign(`interest.${campaignId}.${accountId}`, key);
}

export function verifyCampaignInterestToken(campaignId: string, accountId: string, token: string): boolean {
  const key = secret();
  if (!key || !token) return false;
  const expected = sign(`interest.${campaignId}.${accountId}`, key);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
