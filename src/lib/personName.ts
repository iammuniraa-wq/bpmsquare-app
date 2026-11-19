// A readable name for a person in a notification ("Sap Rashid proposes ...") when the business user has no display name and no
// linked employee. PURE, client-safe. Order: the name the workspace knows (loadActorNames), the name on the login's own profile,
// the part of the e-mail address before the @ made readable, then the fallback. A raw e-mail address is never the answer.

/** "sap.rashid@gmail.com" -> "Sap Rashid". Null when the address has nothing readable before the @. */
export function nameFromEmail(email: string | null | undefined): string | null {
  const local = (email ?? "").trim().split("@")[0]?.split("+")[0] ?? "";
  const words = local.split(/[._\-\s]+/).map((w) => w.replace(/\d+$/, "")).filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return null;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ").slice(0, 80);
}

type LoginLike = { email?: string | null; user_metadata?: Record<string, unknown> | null } | null | undefined;

export function personLabel(known: string | null | undefined, login: LoginLike, fallback: string): string {
  const own = known?.trim();
  if (own && !own.includes("@")) return own;
  const meta = login?.user_metadata;
  const profile = [meta?.full_name, meta?.name].find((v): v is string => typeof v === "string" && v.trim() !== "" && !v.includes("@"));
  return profile?.trim() || nameFromEmail(login?.email) || fallback;
}
