export type TechnicianProfileInput = {
  name: string;
  phone: string;
  email: string;
  base_location: string;
  max_visits_per_day: number;
  status: string;
  skills: string;
  certs: Array<{ name: string; expiry: string }>;
  leaves: Array<{ id: string; from_date: string; to_date: string; reason: string; notes: string }>;
};

// Rows created in the form carry a client-side placeholder id; only real database ids are sent so the server inserts the rest.
const isStoredId = (id: string) => !id.startsWith("leave-new-");

export function technicianSaveBody(input: TechnicianProfileInput) {
  return {
    name: input.name,
    phone: input.phone,
    email: input.email,
    base_location: input.base_location,
    max_visits_per_day: input.max_visits_per_day,
    status: input.status,
    skills: input.skills,
    certifications: input.certs.filter((c) => c.name.trim()).map((c) => ({ name: c.name, expiry: c.expiry })),
    leaves: input.leaves.map((l) => ({
      ...(isStoredId(l.id) ? { id: l.id } : {}),
      from_date: l.from_date,
      to_date: l.to_date,
      reason: l.reason,
      notes: l.notes,
    })),
  };
}

/** Resolves only after a 2xx; otherwise throws the server's message so the screen can show an error toast. */
export async function saveTechnicianProfile(
  id: string,
  input: TechnicianProfileInput,
  doFetch: typeof fetch = fetch,
): Promise<{ leaves: Array<{ id: string; from_date: string; to_date: string; reason: string; notes: string | null }> }> {
  const res = await doFetch(`/api/technicians/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(technicianSaveBody(input)),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? "Could not save the profile");
  }
  const saved = (await res.json().catch(() => null)) as { leaves?: Array<{ id: string; from_date: string; to_date: string; reason: string; notes: string | null }> } | null;
  return { leaves: saved?.leaves ?? [] };
}
