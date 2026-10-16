import { notFound } from "next/navigation";
import { getTechnicianDetail } from "@/lib/data";
import TechnicianConfigForm from "./TechnicianConfigForm";

export default async function TechnicianConfigPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const today = new Date().toISOString().slice(0, 7);
  const data = await getTechnicianDetail(id, today);
  if (!data) notFound();

  return <TechnicianConfigForm technician={data.technician} leaves={data.leaves} />;
}
