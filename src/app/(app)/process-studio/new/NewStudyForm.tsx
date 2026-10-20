"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { studioApi, STUDIO_BASE } from "../studioClient";

// Create is a name and Start: everything else happens inside the study.
export default function NewStudyForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Give the study a name, for example your company."); return; }
    setSaving(true);
    setError("");
    const res = await studioApi<{ id: string }>("POST", STUDIO_BASE, { name });
    if (!res.ok) { setSaving(false); setError(res.error); return; }
    router.push(ROUTES.processStudy(res.data.id));
  }

  return (
    <ObjectFormPage
      backHref={ROUTES.processStudio} backLabel="All studies" title="New study"
      subtitle="Tell us how you work and see how BPMSquare fits. About twenty minutes."
      onSubmit={submit} saving={saving} saveLabel="Start" error={error} maxWidth={560}
    >
      <Card>
        <Field label="Name" hint="Your company or the part of it you want to look at. You can change it later." required>
          <Input value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
      </Card>
    </ObjectFormPage>
  );
}
