"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";

export default function NewTechnicianPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "", phone: "", email: "",
    skills: "", base_location: "", max_visits_per_day: "3",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/technicians", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (res.ok) {
        router.push(ROUTES.technician(json.id));
      } else {
        setError(json.error ?? "Failed to create technician");
      }
    });
  }

  return (
    <ObjectFormPage
      backHref={ROUTES.technicians}
      backLabel="All technicians"
      title="New Technician"
      subtitle="Add a field technician to your team"
      onSubmit={handleSubmit}
      saving={pending}
      saveLabel="Save"
      error={error}
    >
      <Card title="Personal details" padding={18}>
        <Field label="Full name" required>
          <Input value={form.name} onChange={set("name")} required placeholder="e.g. Ramesh Kumar" />
        </Field>
        <div className="fg2">
          <Field label="Phone">
            <Input value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={set("email")} placeholder="tech@company.com" />
          </Field>
        </div>
        <Field label="Skills / specialisations" style={{ marginBottom: 0 }}>
          <Textarea
            value={form.skills} onChange={set("skills")}
            placeholder="e.g. HT motor rewinds, VFD drives, transformer servicing…"
          />
        </Field>
      </Card>

      <Card title="Field settings" padding={18}>
        <div className="fg2">
          <Field label="Base location" style={{ marginBottom: 0 }}>
            <Input value={form.base_location} onChange={set("base_location")} placeholder="e.g. Hosapete workshop" />
          </Field>
          <Field label="Max visits / day" style={{ marginBottom: 0 }}>
            <Input type="number" min={1} max={10} value={form.max_visits_per_day} onChange={set("max_visits_per_day")} />
          </Field>
        </div>
      </Card>
    </ObjectFormPage>
  );
}
