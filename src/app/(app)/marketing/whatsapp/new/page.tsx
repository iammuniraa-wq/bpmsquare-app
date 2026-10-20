import { topicsOf } from "@/lib/marketing/config";
import TemplateStudio from "../TemplateStudio";
import { whatsappPage } from "../pageData";

// A new template. Nothing is saved until the person presses Save.
export default async function NewTemplatePage() {
  const ctx = await whatsappPage("create");
  return (
    <TemplateStudio
      initial={{
        id: null, ref: null, name: "", language: "en", category: "marketing", topic: null, provider_template_name: "", status: "draft", rejection_reason: null, sent: 0,
        body: "Hello {{contact_name}}, your quote {{quote_ref}} is ready to review. Reply here if you have any questions.",
      }}
      topics={topicsOf(ctx.tenant.config).map((t) => ({ key: t.key, label: t.label }))}
      companyName={ctx.tenant.name}
      canEdit={ctx.can.edit && ctx.can.create}
      canDelete={false}
      isAdmin={ctx.role === "admin"}
    />
  );
}
