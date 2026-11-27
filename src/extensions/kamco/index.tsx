/**
 * KAMCO. Only what differs from the standard product.
 */
import type { TenantExtension } from "@/extensions/types";
import base from "@/extensions/_base";

const kamco: TenantExtension = {
  ...base,
  standardQuotePrintStyle: () => "modern",
  standardQuotePrintDefaults: () => ({
    accent: "#0f9d8a",
    intro: "Thank you for your enquiry. We are pleased to submit our quotation as detailed below.",
    signature: true,
  }),
};

export default kamco;
