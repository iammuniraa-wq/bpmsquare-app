import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { EINVOICE_SCHEME, type EinvoiceScheme } from "./rules";

// The one question every e-invoice surface asks: "is this workspace a Saudi e-invoicing workspace?".
//
// Until the Region pack framework exists (docs/design/gcc-sales-estimating-plan.md section 0), the answer is the
// platform-admin flag `einvoicing_ksa` together with `config.einvoicing.scheme`. The flag grants the feature; the
// scheme can switch it off again (`null`). With the flag on and no scheme stored, the scheme is ksa_zatca, so a
// workspace is never stuck "on but doing nothing". When the pack framework lands, only this function changes.

export function einvoicingScheme(
  features: Partial<TenantFeatures> | null | undefined,
  config: Pick<Partial<TenantConfig>, "einvoicing"> | null | undefined,
): EinvoiceScheme | null {
  if (features?.einvoicing_ksa !== true) return null;
  const stored = config?.einvoicing?.scheme;
  if (stored === null) return null;
  return stored === undefined || stored === EINVOICE_SCHEME ? EINVOICE_SCHEME : null;
}

export function einvoicingOn(
  features: Partial<TenantFeatures> | null | undefined,
  config: Pick<Partial<TenantConfig>, "einvoicing"> | null | undefined,
): boolean {
  return einvoicingScheme(features, config) !== null;
}
