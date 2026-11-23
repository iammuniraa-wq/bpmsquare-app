import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterEdit } from "@/lib/permissions";
import NewDrawingForm from "@/components/drawings/NewDrawingForm";

export default async function NewDrawingPage() {
  await requireWorkcenterEdit("drawing_register");
  await requireFeature("drawing_register");
  return <NewDrawingForm />;
}
