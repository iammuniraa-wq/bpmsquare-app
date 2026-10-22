import { NAV, type TenantFeatures } from "@/lib/constants";
import { SETTINGS_GROUPS, SETTINGS_MENU, type SettingsGroupId } from "@/lib/settingsMenu";

// What the platform admin sees next to each module flag: where it belongs, what
// it switches on, and what it leans on. Nothing here is a new rule -- every
// dependency below is one the code already enforces or documents, with the
// place it lives named so it can be checked.

type Key = keyof TenantFeatures;

export type FeatureDependency = {
  key: Key;
  needs: Key;
  /** "hard": the module does not work without it. "partial": one part of it does not. */
  strength: "hard" | "partial";
  why: string;
};

export const FEATURE_DEPENDENCIES: FeatureDependency[] = [
  {
    key: "wfm", needs: "business_roles", strength: "hard",
    why: "The employee master, Business Users and the automatic Workforce roles hang off Business Roles (tenant provisioning runbook section 0; the Tenant Studio turns it on for you).",
  },
  {
    key: "wfm_projects", needs: "wfm", strength: "hard",
    why: "Project costing is a layer inside Workforce: hours come from attendance and the Projects screen sits under the Workforce nav.",
  },
  {
    key: "wfm_projects", needs: "invoices", strength: "partial",
    why: "Project billing in Workforce settings, and invoicing project hours, only appear with Invoices on.",
  },
  {
    key: "pricing_engine_quotes", needs: "pricing_engine", strength: "hard",
    why: "Both flags are required at every place a quote line pulls a live price.",
  },
  {
    key: "newsletter_studio", needs: "marketing", strength: "hard",
    why: "Newsletters are handed to a Marketing campaign to be sent, and use its audiences, unsubscribe and consent rules.",
  },
  {
    key: "buying_signals", needs: "marketing", strength: "hard",
    why: "Signals feed Marketing target groups and campaigns (buying stage and score are audience fields) and the Did it work? view reads campaign sends.",
  },
  {
    key: "marketing_forms", needs: "marketing", strength: "hard",
    why: "Forms feed Marketing: each submit records consent, creates the contact and files a lead.",
  },
  {
    key: "abm", needs: "marketing", strength: "hard",
    why: "Target lists are built from Marketing target groups, and ABM programs sit in the Marketing menu with its consent rules.",
  },
  {
    key: "journeys", needs: "marketing", strength: "hard",
    why: "Journeys follow people from Marketing audiences and respect its consent and unsubscribe rules.",
  },
  {
    key: "whatsapp_marketing", needs: "marketing", strength: "hard",
    why: "WhatsApp messages follow Marketing consent and topics, and sit in the Marketing menu.",
  },
  {
    key: "marketing_events", needs: "marketing", strength: "hard",
    why: "Events sit in the Marketing menu and follow its consent rules.",
  },
  {
    key: "marketing_events", needs: "marketing_forms", strength: "hard",
    why: "People register for an event through a Form, which records their consent.",
  },
  {
    key: "marketing_events", needs: "journeys", strength: "partial",
    why: "The follow-up for attendees or no-shows starts a journey; without Journeys the event works but nothing can be started.",
  },
  {
    key: "marketing_attribution", needs: "marketing", strength: "hard",
    why: "Attribution reads Marketing's campaign, form and journey activity and sits in the Marketing menu.",
  },
  {
    key: "marketing_attribution", needs: "pipeline", strength: "partial",
    why: "Revenue is read from deals; without Pipeline there are touches but nothing to credit.",
  },
  {
    key: "journeys", needs: "newsletter_studio", strength: "partial",
    why: "The Send newsletter step needs a newsletter from the Newsletter Studio; the other steps work without it.",
  },
  {
    key: "ai_assistant_actions", needs: "ai_assistant", strength: "hard",
    why: "The cards are shown by the assistant's chat and the create tool is part of its loop.",
  },
  {
    key: "ai_assistant_actions", needs: "next_experience", strength: "hard",
    why: "Writing from the assistant is an experimental surface: it is gated on Nova like the rest of it (bpmsquarecore.md section 10, rule 1).",
  },
  {
    key: "marketing_scoring", needs: "marketing", strength: "hard",
    why: "Scoring, consent and topics are settings of the Marketing module; its settings pages sit under Marketing campaigns being on.",
  },
];

/** The settings-menu group each module reads under in the tenant editor. */
export const FEATURE_GROUP: Partial<Record<Key, SettingsGroupId>> = {
  // Sales
  accounts: "sales", contacts: "sales", quotations: "sales", standard_quotes: "sales", quote_lines_dw: "sales",
  pipeline: "sales", leads: "sales", invoices: "sales", partners: "sales", marketing: "sales", rfq: "sales",
  products: "sales", suppliers: "sales", purchasing: "sales", pricing_engine: "sales", pricing_engine_quotes: "sales",
  coverage_model: "sales", fence_projects: "sales", estimator: "sales", marketing_scoring: "marketing", process_studio: "sales", newsletter_studio: "marketing", buying_signals: "marketing", marketing_forms: "marketing", abm: "marketing", journeys: "marketing", whatsapp_marketing: "marketing", marketing_attribution: "marketing", marketing_events: "marketing",
  // Service
  cases: "service", work_orders: "service", technicians: "service", assets: "service", amc: "service", dispatch: "service",
  // Workforce
  wfm: "workforce", wfm_projects: "workforce",
  // Users & access
  business_roles: "access", administration: "access",
  // Data
  reports: "data", data_workbench: "data", db_export: "data", change_history: "data",
  // Integrations
  outbound_email: "integrations", gmail_reply_threading: "integrations", ai_assistant: "integrations", ai_assistant_actions: "integrations", ai_reports: "integrations",
  // Appearance
  next_experience: "appearance", enterprise_theme: "appearance", spectacular_theme: "appearance",
};

export function groupLabelForFeature(key: Key): string {
  const id = FEATURE_GROUP[key];
  return SETTINGS_GROUPS.find((g) => g.id === id)?.label ?? "Other";
}

/** Dependencies of `key` that the given flag set does not satisfy. */
export function unmetDependencies(features: Partial<TenantFeatures>, key: Key): FeatureDependency[] {
  return FEATURE_DEPENDENCIES.filter((d) => d.key === key && features[d.needs] !== true);
}

/** Flags that are ON and lean on `key`: switching it off would strand them. */
export function dependantsOn(features: Partial<TenantFeatures>, key: Key): FeatureDependency[] {
  return FEATURE_DEPENDENCIES.filter((d) => d.needs === key && features[d.key] === true);
}

/** Sidebar entries and settings pages that exist only while `key` is on. */
export function featureUnlocks(key: Key): { nav: string[]; settings: string[] } {
  const nav: string[] = [];
  for (const g of NAV) {
    for (const item of g.items) {
      if (!item.children?.length && item.featureKey === key) nav.push(item.label);
      for (const ch of item.children ?? []) if (ch.featureKey === key) nav.push(ch.label);
    }
  }
  const settings = SETTINGS_MENU.filter((m) => m.featureKey === key).map((m) => m.label);
  return { nav: [...new Set(nav)], settings };
}
