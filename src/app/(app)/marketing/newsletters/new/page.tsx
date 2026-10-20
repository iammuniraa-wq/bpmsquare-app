import { builtInDesign, footerTexts, languageRowsOf } from "@/lib/newsletter/designs";
import { loadBundle } from "@/lib/newsletter/server";
import { isUuid } from "@/lib/newsletter/requests";
import type { LanguageRow, NewsletterBlock, NewsletterCategory } from "@/lib/newsletter/types";
import NewsletterStudio from "../NewsletterStudio";
import { studioPage, studioProps } from "../pageData";

// A new newsletter. Nothing is saved until the person presses Save. The page can start from a
// built-in design (?from=builtin:eid) or from one of the workspace's templates (?from=template:<id>);
// the template id is read through the tenant-scoped loader, so another workspace's id finds nothing.
export default async function NewNewsletterPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const ctx = await studioPage();
  const props = await studioProps(ctx);
  const { from } = await searchParams;

  let name = "";
  let category: NewsletterCategory = "Newsletter";
  let blocks: NewsletterBlock[] = [
    { id: "header1", type: "header", visible: true, locked: true, settings: {} },
    { id: "footer1", type: "footer", visible: true, locked: true, settings: {} },
  ];
  let languages: LanguageRow[] = [{
    lang: "en", dir: "ltr", subject: "", preheader: "", texts: { header1: { tag: "" }, footer1: footerTexts(ctx.kit.footerAddress) },
    review: { header1: "written", footer1: "written" }, status: "ready", translated_by: "person",
  }];
  let templateOriginId: string | null = null;
  let builtInOrigin: string | null = null;

  if (from?.startsWith("builtin:")) {
    const d = builtInDesign(from.slice(8));
    if (d) { name = d.name; category = d.category; blocks = d.blocks; languages = languageRowsOf(d, ctx.kit.footerAddress); builtInOrigin = d.id; }
  } else if (from?.startsWith("template:") && isUuid(from.slice(9))) {
    const r = await loadBundle(ctx, from.slice(9));
    if (r.data?.newsletter.is_template) {
      name = r.data.newsletter.name; category = r.data.newsletter.category; blocks = r.data.newsletter.blocks; languages = r.data.languages;
      templateOriginId = r.data.newsletter.id; builtInOrigin = r.data.newsletter.built_in_origin;
    }
  }

  return (
    <NewsletterStudio
      {...props}
      initial={{
        id: null, ref: null, name, category, topic: null, status: "draft", isTemplate: false, blocks, languages, versions: [],
        templateOriginId, builtInOrigin, createdAt: null,
      }}
    />
  );
}
