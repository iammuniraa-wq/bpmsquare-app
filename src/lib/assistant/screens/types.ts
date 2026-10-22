import type { WorkcenterKey } from "@/lib/workcenters";

// What the assistant knows about a screen. A manifest is data: the guide overlay, the prompt and the tests all read
// the same shape, so nothing grows a branch per screen. Pure and client-safe (docs/design/assistant-smarter.md 1.1).

/** What a person needs beyond seeing the screen to use a control. */
export type Need = "create" | "edit" | "admin";

export type Control = {
  /** `<screen>.<control>`, stable, registered by a component as data-guide="<id>". Never a DOM path or a class. */
  id: string;
  label: string;
  /** One line: what pressing it or filling it does. */
  does: string;
  /** Tab that must be open for the control to exist; the overlay switches to it first. */
  tab?: string;
  /** The control sits inside this other control (a menu): when it is not on the page, point at the parent. */
  within?: string;
  /** Element id for controls the studios' Tours already point at by id. Used when no data-guide is on the page. */
  domId?: string;
  featureKey?: string;
  workcenter?: WorkcenterKey;
  needs?: Need;
};

/** A step without a control is a plain instruction (nothing to highlight). */
export type TaskStep = { control?: string; text: string };
export type Task = { id: string; label: string; steps: TaskStep[] };
export type ScreenTab = { id: string; label: string; what: string; featureKey?: string };

export type ScreenKind = "detail" | "new" | "edit" | "list" | "settings" | "studio" | "nav";

export type ScreenManifest = {
  /** "quote.detail", "settings.webhooks", "marketing.forms". */
  id: string;
  match: (path: string) => boolean;
  title: string;
  purpose: string;
  kind: ScreenKind;
  /** Object type whose registry fields are added per tenant (detail, new, edit). */
  objectType?: string;
  featureKey?: string;
  /** Shown when ANY of these modules is on (a Settings page that serves several). */
  featureAnyOf?: string[];
  /** Hidden when this module is ON (a page another one replaces). */
  hiddenWhenFeature?: string;
  workcenter?: WorkcenterKey;
  adminOnly?: boolean;
  /** For an adminOnly screen: a non-admin whose role grants EDIT on this workcenter may still open it. */
  editWorkcenter?: WorkcenterKey;
  tabs?: ScreenTab[];
  controls: Control[];
  tasks: Task[];
  prerequisites?: string[];
};

/** The hand-written half: verbs and tasks added to a generated manifest of the same id. */
export type ScreenOverlay = {
  id: string;
  purpose?: string;
  tabs?: ScreenTab[];
  controls?: Control[];
  tasks?: Task[];
  prerequisites?: string[];
};

/** Who is asking: the same gates the sidebar, the Settings menu and the palette use. */
export type ScreenAccess = {
  features: Record<string, boolean | undefined>;
  isAdmin: boolean;
  canView: (wc: WorkcenterKey) => boolean;
  canCreate: (wc: WorkcenterKey) => boolean;
  canEdit: (wc: WorkcenterKey) => boolean;
};

/** A field as the tenant has it configured now (standard and custom), reduced to what a guide needs. */
export type ScreenField = { key: string; label: string; section: string; required: boolean; locked: boolean; editable: boolean; custom: boolean };

export type HiddenControl = { id: string; label: string; reason: string; alternative?: string };

/** What the caller may see of a manifest, and what was taken out for them and why. */
export type VisibleScreen = {
  manifest: ScreenManifest;
  fields: ScreenField[];
  hidden: HiddenControl[];
};

export const MAX_CONTROLS = 12;
export const MAX_TASKS = 6;
export const MAX_TEXT = 160;
