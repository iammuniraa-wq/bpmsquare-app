import { topicsOf } from "@/lib/marketing/config";
import { newFormDefaults } from "@/lib/marketing/forms/server";
import { tenantOrigin } from "@/lib/constants";
import FormStudio from "../FormStudio";
import { formsPage } from "../pageData";

// A new form. Nothing is saved until the person presses Save.
export default async function NewFormPage() {
  const ctx = await formsPage();
  const d = newFormDefaults(ctx);
  return (
    <FormStudio
      initial={{
        id: null, ref: null, name: d.name, slug: d.slug, status: d.status, title: d.title, intro: d.intro, button_label: d.button_label,
        fields: d.fields, consent: d.consent, after_submit: d.after_submit, createdAt: null,
      }}
      topics={topicsOf(ctx.config).map((t) => ({ key: t.key, label: t.label }))}
      origin={ctx.customDomain || ctx.isDemo ? tenantOrigin(ctx.customDomain) : ""}
      redirectHost={ctx.customDomain ?? ""}
      brand={{ name: ctx.tenantName, logoUrl: null }}
      submissions={[]}
      canEdit={ctx.can.edit && ctx.can.create}
      canDelete={false}
    />
  );
}
