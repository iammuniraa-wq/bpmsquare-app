/**
 * Base (default) extension — no-ops for all extension points.
 * Every tenant that has no override gets this behaviour.
 */
import type { TenantExtension } from "@/extensions/types";

const base: TenantExtension = {
  extraCustomFields: () => [],
  quoteSignatureSlot: () => null,
  quoteExtraSection: () => null,
  quoteSubject: (name) => name,
  beforeSaveAccount: () => ({ ok: true }),
  beforeSaveContact: () => ({ ok: true }),
  beforeSaveAsset: () => ({ ok: true }),
};

export default base;
