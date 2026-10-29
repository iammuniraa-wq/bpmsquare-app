/**
 * Fields that are stored encrypted (see src/lib/encryption.ts) or are a person's contact details.
 * Kept as its own small map rather than importing encryption.ts's private ACCOUNT_PII/CONTACT_PII
 * consts, since its failure mode is different: a bug here must never leak a plaintext PII value
 * into an otherwise-unencrypted audit table or an outbound feed, so the list is deliberately
 * explicit and reviewed here, not inherited silently. Pure data, importable anywhere.
 */
export const PII_FIELDS: Record<string, Set<string>> = {
  accounts: new Set(["phone", "phone2", "email", "email2", "gstin", "buyer_id_number"]),
  contacts: new Set(["phone", "phone2", "phone3", "email", "email2"]),
  // employees stores these plaintext (bpmsquarecore.md §7's encryption scope
  // is accounts/contacts only), but the audit log redacts them anyway --
  // consistent treatment of a person's contact details regardless of which
  // table they live in.
  employees: new Set(["phone", "email"]),
  // The Talk to us contact email on a process study (encrypted at rest).
  process_studies: new Set(["contact_email"]),
};
