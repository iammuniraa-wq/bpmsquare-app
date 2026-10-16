"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import CreateExtraFields from "@/components/fields/CreateExtraFields";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";

const CORE_ASSET_KEYS = ["name", "kind", "make", "model", "serial", "rating", "notes", "account_id", "is_loaner"];

const KINDS = [
  { value: "motor",       label: "Motor" },
  { value: "transformer", label: "Transformer" },
  { value: "pump",        label: "Pump" },
  { value: "generator",   label: "Generator" },
  { value: "panel",       label: "Panel / Switchgear" },
];

type AccountOption = { id: string; name: string };

export default function NewAssetPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillAccountId = searchParams.get("account_id") ?? "";
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  const [form, setForm] = useState({
    name: "", kind: "motor", make: "", model: "",
    rating: "", serial: "", notes: "",
    account_id: prefillAccountId, is_loaner: false,
  });
  const [extra, setExtra] = useState<Record<string, unknown>>({});
  const [customData, setCustomData] = useState<Record<string, unknown>>({});

  const setExtraField = (key: string, value: unknown, kind: "standard" | "custom") => {
    if (kind === "custom") setCustomData((d) => ({ ...d, [key]: value }));
    else setExtra((e) => ({ ...e, [key]: value }));
  };

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data: AccountOption[]) => setAccounts(data ?? []))
      .catch(() => {});
  }, []);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const backHref = prefillAccountId ? ROUTES.account(prefillAccountId) : ROUTES.assets;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...extra, custom_data: customData }),
      });
      const json = await res.json();
      if (res.ok) {
        // Created from an account page (it passes ?account_id=) -- return
        // there so the new asset shows up under it, rather than dropping
        // the rep on the unfiltered assets list.
        router.push(backHref);
      } else {
        setError(json.error ?? "Failed to create asset");
      }
    });
  }

  return (
    <ObjectFormPage
      backHref={backHref}
      backLabel={prefillAccountId ? "Back to account" : "All assets"}
      title="New Asset"
      subtitle="Register a customer asset or loaner unit"
      onSubmit={handleSubmit}
      saving={pending}
      saveLabel="Save"
      error={error}
    >
      <Card title="Equipment" padding={18}>
        <Field label="Asset name" required>
          <Input value={form.name} onChange={set("name")} required placeholder="e.g. Ring-frame drive motor" />
        </Field>
        <div className="fg2">
          <Field label="Kind" required>
            <Select value={form.kind} onChange={set("kind")} required>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </Field>
          <Field label="Make / brand">
            <Input value={form.make} onChange={set("make")} placeholder="e.g. Crompton Greaves" />
          </Field>
          <Field label="Model">
            <Input value={form.model} onChange={set("model")} placeholder="e.g. ND315S-2" />
          </Field>
          <Field label="Serial number">
            <Input value={form.serial} onChange={set("serial")} placeholder="e.g. CG-75-2291" />
          </Field>
        </div>
        <Field label="Rating / specs">
          <Input value={form.rating} onChange={set("rating")} placeholder="e.g. 75 kW · 415V · 1480 rpm" />
        </Field>
        <Field label="Notes / history" style={{ marginBottom: 0 }}>
          <Textarea
            value={form.notes}
            onChange={set("notes")}
            placeholder="e.g. Rewound once — June 2024. Bearings last replaced Jan 2025."
          />
        </Field>
      </Card>

      <Card title="Ownership" padding={18}>
        <Field label="Customer account">
          <Select value={form.account_id} onChange={set("account_id")}>
            <option value="">— None (loaner / workshop stock) —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={form.is_loaner}
            onChange={(e) => setForm((f) => ({ ...f, is_loaner: e.target.checked }))}
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
          This is a loaner unit
        </label>
      </Card>

      <CreateExtraFields
        objectType="asset"
        exclude={CORE_ASSET_KEYS}
        values={{ ...form, ...extra, ...customData }}
        onChange={setExtraField}
      />
    </ObjectFormPage>
  );
}
