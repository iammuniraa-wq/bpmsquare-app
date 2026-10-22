// A person who is looking at a Yes / No question may type the answer instead of pressing the chip. The typed word
// only presses the same chip (the signed token still decides on the server), so nothing is consented to by guessing:
// only a bare yes or no counts, anything longer is a new question.
const YES = /^(yes|y|yep|yeah|ok|okay|sure|go ahead|do it|please do|yes please)[.!]*$/i;
const NO = /^(no|n|nope|cancel|stop|not now|no thanks|dont|don't)[.!]*$/i;

export function consentReplyOf(text: string): "yes" | "no" | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length === 0 || t.length > 20) return null;
  if (YES.test(t)) return "yes";
  if (NO.test(t)) return "no";
  return null;
}
