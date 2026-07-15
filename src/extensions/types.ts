/**
 * Extension point interface — the "BAdI definitions" for the standard product.
 *
 * Each method is an optional hook. The standard product calls these at defined
 * points in the UI/business logic. _base/ provides no-op defaults; tenant
 * folders override only what they need.
 *
 * Adding a new extension point: add it here (optional) + add a no-op in _base/.
 * Existing tenant extensions are unaffected — TypeScript optional fields ensure
 * this is safe to extend without breaking anything.
 */

import type { ReactNode } from "react";
import type { Account, Contact, Asset } from "@/lib/types";
import type { CustomFieldDef } from "@/lib/constants";

// ─── Quote print extension points ──────────────────────────────────────────

export type QuotePrintContext = {
  /** The company (tenant) whose quote this is */
  companyName: string;
  /** The customer account */
  accountName: string | null;
};

// ─── Field extension points ─────────────────────────────────────────────────

export type ObjectType = "account" | "contact" | "asset" | "case" | "work_order" | "lead";

// ─── Business logic hooks ───────────────────────────────────────────────────

export type SaveResult = { ok: true } | { ok: false; error: string };

// ─── The full extension interface ───────────────────────────────────────────

export interface TenantExtension {
  /**
   * Extra custom field definitions injected into an object form,
   * on top of whatever is in tenants.config.custom_fields.
   * Return [] to add nothing.
   */
  extraCustomFields?(objectType: ObjectType): CustomFieldDef[];

  /**
   * Renders inside the quote print left signature box,
   * between the "For {company}" label and the "Authorised Signatory" line.
   * Return null to render nothing (standard spacer used).
   */
  quoteSignatureSlot?(ctx: QuotePrintContext): ReactNode;

  /**
   * Renders an additional section appended after the standard quote body
   * (before the footer). Return null to add nothing.
   */
  quoteExtraSection?(ctx: QuotePrintContext): ReactNode;

  /**
   * Called before an account is saved (create or update).
   * Return { ok: false, error } to block the save with a validation message.
   */
  beforeSaveAccount?(data: Partial<Account>): SaveResult | Promise<SaveResult>;

  /**
   * Called before a contact is saved.
   */
  beforeSaveContact?(data: Partial<Contact>): SaveResult | Promise<SaveResult>;

  /**
   * Called before an asset is saved.
   */
  beforeSaveAsset?(data: Partial<Asset>): SaveResult | Promise<SaveResult>;
}
