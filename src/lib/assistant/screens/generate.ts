import { NAV, ROUTES, type NavItem } from "@/lib/constants";
import { SETTINGS_MENU } from "@/lib/settingsMenu";
import type { WorkcenterKey } from "@/lib/workcenters";
import { OBJECT_DEFS, isUuid, type ObjectDef } from "../objects";
import { ATTRIBUTION_TOUR } from "@/lib/marketing/attribution/tourSteps";
import { FORM_TOUR } from "@/lib/marketing/forms/tourSteps";
import { JOURNEY_TOUR } from "@/lib/marketing/journeys/tourSteps";
import { NEWSLETTER_TOUR } from "@/lib/newsletter/tourSteps";
import { SIGNALS_TOUR } from "@/lib/signals/tourSteps";
import { WHATSAPP_TOUR } from "@/lib/marketing/whatsapp/tourSteps";
import type { TourStepDef } from "@/lib/studio/tourSteps";
import type { Control, ScreenManifest, Task } from "./types";
import { INBOX_DETAIL } from "./inbox";

// The generated half of every screen manifest: built from the tables the product already runs on (the object
// definitions, the Settings menu, the sidebar, the studios' Tour lists), so a new screen wired the usual way is
// known to the assistant the moment it exists. Only verbs and tasks are written by hand (screens/*.ts overlays).

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const prefixOf = (d: ObjectDef): string => d.detail("x").slice(0, -1).replace(/\/$/, "");

/** Detail pages that do not use the shared record template, so the template's controls do not apply to them. */
const BESPOKE_DETAIL = new Set<string>(["quote", "opportunity", "rfq"]);

const navItems = (): { item: NavItem; section: string }[] => {
  const out: { item: NavItem; section: string }[] = [];
  for (const g of NAV) {
    for (const it of g.items) {
      if (it.children?.length) for (const ch of it.children) out.push({ item: ch, section: it.label });
      else out.push({ item: it, section: g.group });
    }
  }
  return out;
};

const navFor = (href: string) => navItems().find((n) => n.item.href === href)?.item;

const RECORD_CONTROLS: Control[] = [
  { id: "record.back", label: "Back to the list", does: "Returns to the list this record belongs to." },
  { id: "record.primary", label: "Main action", does: "The one next step for this record, top right, when it has one." },
  { id: "record.more", label: "More actions (the three dots)", does: "Opens the menu with Edit, Print / PDF, Duplicate, Adapt fields and Delete, as far as this record has them." },
  { id: "menu:edit", label: "Edit", does: "Changes this record's details.", within: "record.more", needs: "edit" },
  { id: "menu:delete", label: "Delete", does: "Deletes this record after a confirmation; there are a few seconds to undo.", within: "record.more", needs: "edit" },
  { id: "record.edit_details", label: "Edit details", does: "Turns the Details card into inputs in place.", needs: "edit", tab: "overview" },
  { id: "record.save_details", label: "Save details", does: "Saves the changed fields.", needs: "edit", tab: "overview" },
];

const detailTasks = (noun: string): Task[] => [
  {
    id: "edit_details",
    label: `Change a ${noun}'s details`,
    steps: [
      { control: "record.edit_details", text: "Press Edit in the Details card; the fields become inputs." },
      { text: "Change what you need. A field marked * is required." },
      { control: "record.save_details", text: "Press Save." },
    ],
  },
];

function objectScreens(): ScreenManifest[] {
  const out: ScreenManifest[] = [];
  for (const d of OBJECT_DEFS) {
    const prefix = prefixOf(d);
    const common = { featureKey: d.featureKey, workcenter: d.workcenter, objectType: d.type };
    const bespoke = BESPOKE_DETAIL.has(d.type);
    out.push({
      id: `${d.type}.list`, kind: "list", title: `${cap(d.noun)} list`, purpose: `Every ${d.noun} in the workspace, with search, filters and sorting.`,
      match: (p) => p === d.list, ...common,
      controls: [{ id: "list.new", label: `New ${d.noun}`, does: `Opens the form for a new ${d.noun}.`, needs: "create" }],
      tasks: [{ id: "create", label: `Create a ${d.noun}`, steps: [{ control: "list.new", text: `Press + New ${d.noun}.` }, { text: "Fill in the details and press Save." }] }],
    });
    out.push({
      id: `${d.type}.new`, kind: "new", title: `New ${d.noun}`, purpose: `The form that creates a ${d.noun}.`,
      match: (p) => p === `${prefix}/new`, ...common,
      controls: [
        { id: "form.save", label: "Save", does: `Creates the ${d.noun}.`, needs: "create" },
        { id: "form.cancel", label: "Cancel", does: "Leaves without saving." },
      ],
      tasks: [{ id: "create", label: `Create a ${d.noun}`, steps: [{ text: "Fill in the fields; a field marked * is required." }, { control: "form.save", text: "Press Save." }] }],
    });
    out.push({
      id: `${d.type}.edit`, kind: "edit", title: `Edit ${d.noun}`, purpose: `The form that changes a ${d.noun}.`,
      match: (p) => p.startsWith(`${prefix}/`) && isUuid(p.slice(prefix.length + 1).split("/")[0]) && p.endsWith("/edit"), ...common,
      controls: [
        { id: "form.save", label: "Save", does: "Saves the changes.", needs: "edit" },
        { id: "form.cancel", label: "Cancel", does: "Leaves without saving." },
      ],
      tasks: [{ id: "change", label: `Change a ${d.noun}`, steps: [{ text: "Change the fields you need." }, { control: "form.save", text: "Press Save." }] }],
    });
    out.push({
      id: `${d.type}.detail`, kind: "detail", title: cap(d.noun), purpose: `One ${d.noun}: its details, related records and history.`,
      match: (p) => p.startsWith(`${prefix}/`) && isUuid(p.slice(prefix.length + 1).split("/")[0]) && p.slice(prefix.length + 1).split("/").length === 1, ...common,
      controls: bespoke ? [] : RECORD_CONTROLS.map((c) => ({ ...c })),
      tasks: bespoke ? [] : detailTasks(d.noun),
    });
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function settingsScreens(): ScreenManifest[] {
  return SETTINGS_MENU.filter((m) => !m.external).map((m) => ({
    id: `settings.${slug(m.id)}`, kind: "settings" as const, title: m.label, purpose: m.description,
    match: (p: string) => p === m.href || p.startsWith(`${m.href}/`),
    adminOnly: m.adminOnly, editWorkcenter: m.relatedWorkcenter,
    featureKey: m.featureKey as string | undefined,
    featureAnyOf: m.featureAnyOf as string[] | undefined,
    hiddenWhenFeature: m.hiddenWhenFeature as string | undefined,
    controls: [], tasks: [],
  }));
}

type StudioDef = {
  id: string; navHref: string; title: string; purpose: string; steps: readonly TourStepDef[]; match: (p: string) => boolean;
};

const under = (base: string, except: string[] = []) => (p: string) =>
  p.startsWith(`${base}/`) && p.split("/").length === base.split("/").length + 1 && !except.includes(p.slice(base.length + 1));

const STUDIOS: StudioDef[] = [
  { id: "marketing.forms", navHref: ROUTES.marketingForms, title: "Form studio", purpose: "Build a sign-up form: what it asks, the consent words, what happens after, and where to share it.", steps: FORM_TOUR, match: under(ROUTES.marketingForms) },
  { id: "marketing.journeys", navHref: ROUTES.marketingJourneys, title: "Journey studio", purpose: "Design an automated series of messages, check who would enter, and try it on a real person before going live.", steps: JOURNEY_TOUR, match: under(ROUTES.marketingJourneys) },
  { id: "marketing.newsletters", navHref: ROUTES.marketingNewsletters, title: "Newsletter studio", purpose: "Write a newsletter from blocks, translate it, preview it on phone and desktop, and send it.", steps: NEWSLETTER_TOUR, match: under(ROUTES.marketingNewsletters) },
  { id: "marketing.signals", navHref: ROUTES.marketingSignals, title: "Buying signals", purpose: "Accounts ranked by how ready they look to buy, with the signals behind each score.", steps: SIGNALS_TOUR, match: (p) => p === ROUTES.marketingSignals },
  { id: "marketing.whatsapp", navHref: ROUTES.marketingWhatsapp, title: "WhatsApp template studio", purpose: "Write a WhatsApp message template, choose its consent topic and mark it approved.", steps: WHATSAPP_TOUR, match: under(ROUTES.marketingWhatsapp, ["setup"]) },
  { id: "marketing.attribution", navHref: ROUTES.marketingAttribution, title: "Revenue by source", purpose: "Which campaigns, forms and newsletters started the deals, under the credit rule you choose.", steps: ATTRIBUTION_TOUR, match: (p) => p === ROUTES.marketingAttribution },
];

function studioScreens(): ScreenManifest[] {
  return STUDIOS.map((s) => {
    const nav = navFor(s.navHref);
    const controls: Control[] = [];
    const seen = new Set<string>();
    for (const st of s.steps) {
      if (seen.has(st.target)) continue;
      seen.add(st.target);
      controls.push({ id: `${s.id}.${st.target}`, label: st.label, does: st.text, domId: st.target });
    }
    const idOf = (t: string) => `${s.id}.${t}`;
    return {
      id: s.id, kind: "studio" as const, title: s.title, purpose: s.purpose, match: s.match,
      featureKey: nav?.featureKey, workcenter: nav?.workcenterKey as WorkcenterKey | undefined,
      controls,
      tasks: [{ id: "tour", label: "Walk through this screen", steps: s.steps.map((st) => ({ control: idOf(st.target), text: st.text })) }],
    };
  });
}

function navScreens(taken: Set<string>): ScreenManifest[] {
  const out: ScreenManifest[] = [];
  for (const { item, section } of navItems()) {
    if (taken.has(item.href)) continue;
    taken.add(item.href);
    out.push({
      id: `nav.${slug(item.href) || "home"}`, kind: "nav", title: item.label, purpose: `The ${item.label} screen, in ${section.toLowerCase()}.`,
      match: (p) => p === item.href, featureKey: item.featureKey, workcenter: item.workcenterKey as WorkcenterKey | undefined,
      adminOnly: item.adminOnly, controls: [], tasks: [],
    });
  }
  return out;
}

/** Every generated manifest, before the hand-written overlays are laid over them. */
export function generatedManifests(): ScreenManifest[] {
  const objects = objectScreens();
  const studios = studioScreens();
  // A sidebar route already covered by an object's list or by a studio that IS that page gets no second manifest.
  const taken = new Set<string>([...OBJECT_DEFS.map((d) => d.list), ...STUDIOS.filter((s) => s.match(s.navHref)).map((s) => s.navHref)]);
  // Studios first: their paths are more specific than a list or a detail with a UUID.
  return [...studios, ...objects, INBOX_DETAIL, ...settingsScreens(), ...navScreens(taken)];
}

export { STUDIOS };
