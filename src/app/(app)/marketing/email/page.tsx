import { getTenant } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import type { ListChip } from "@/components/page/ObjectListPage";
import SendsList from "./SendsList";
import DesignsList from "../newsletters/DesignsList";

type Params = { view?: string; q?: string; page?: string; template?: string; status?: string };

/**
 * Email: one entry for campaigns and newsletters (docs/design/marketing-two-parts.md, slice 2). Sends is the history of
 * every email (each newsletter send is a campaign row); Newsletters and Templates are the Newsletter Studio lists and
 * appear only in a workspace that has the studio. Each view keeps its own access check.
 */
export default async function EmailPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const tenant = await getTenant();
  const studio = !!tenant?.features?.newsletter_studio;
  const view = studio && (sp.view === "designs" || sp.view === "templates") ? sp.view : "sends";

  const chip = (id: string, label: string, v: string): ListChip => ({
    id, label, active: view === v,
    href: v === "sends" ? ROUTES.marketingEmail : `${ROUTES.marketingEmail}?view=${v}`,
  });
  const viewChips: ListChip[] | undefined = studio
    ? [chip("sends", "Sends", "sends"), chip("designs", "Newsletters", "designs"), chip("templates", "Templates", "templates")]
    : undefined;

  if (view === "sends" || !viewChips) return <SendsList q={sp.q} page={sp.page} viewChips={viewChips} studio={studio} />;
  const raw: Record<string, string | undefined> = { q: sp.q, page: sp.page };
  return <DesignsList raw={raw} template={view === "templates"} viewChips={viewChips} />;
}
