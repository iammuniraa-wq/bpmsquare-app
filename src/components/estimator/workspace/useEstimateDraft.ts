"use client";

import { useCallback, useMemo, useState } from "react";
import { initialValues } from "@/components/estimator/InputsForm";
import type { InputValues } from "@/components/estimator/InputsForm";
import type { IntakeProposal, SenderInfo } from "@/lib/estimator/ai";
import type { WorkspaceTemplate } from "./types";

export type DraftInit = {
  templateId: string;
  params?: Record<string, number | string | boolean>;
  margin?: number;
  customer?: string;
  accountId?: string;
  contactId?: string;
  notes?: string;
};

/** Everything the person is editing on the working page, held in one place. */
export function useEstimateDraft(templates: readonly WorkspaceTemplate[], init: DraftInit) {
  const [templateId, setTemplateId] = useState(init.templateId);
  const template = templates.find((t) => t.id === templateId) ?? templates[0] ?? null;
  const [typed, setValues] = useState<InputValues>(() => initialValues(template?.inputs ?? [], init.params));
  // An input the template gained since (a recalculation) starts at its default.
  const values = useMemo<InputValues>(() => ({ ...initialValues(template?.inputs ?? []), ...typed }), [template, typed]);
  const [margin, setMargin] = useState(String(init.margin ?? 0));
  const [customer, setCustomer] = useState(init.customer ?? "");
  const [accountId, setAccountId] = useState(init.accountId ?? "");
  const [contactId, setContactId] = useState(init.contactId ?? "");
  const [notes, setNotes] = useState(init.notes ?? "");
  const [customData, setCustomData] = useState<Record<string, unknown>>({});
  // A new estimate shows no villa and no price until the person starts: reads an email
  // or changes a detail (a copy of an existing estimate starts with its own figures).
  // Who the email said it is from; offered as a new account and contact until one is chosen.
  const [sender, setSender] = useState<SenderInfo | null>(null);
  const [started, setStarted] = useState(!!init.params && Object.keys(init.params).length > 0);

  const pickTemplate = useCallback((id: string) => {
    setTemplateId(id);
    setValues(initialValues(templates.find((t) => t.id === id)?.inputs ?? []));
  }, [templates]);

  const setValue = useCallback((key: string, v: string | boolean) => {
    setStarted(true);
    setValues((s) => ({ ...s, [key]: v }));
  }, []);

  const applyProposal = useCallback((p: IntakeProposal) => {
    if (!template) return;
    setStarted(true);
    if (p.sender) setSender(p.sender);
    setValues((s) => {
      const next = { ...s };
      for (const i of template.inputs) {
        const v = p.values[i.key];
        if (v === undefined) continue;
        next[i.key] = i.type === "boolean" ? v === true : String(v);
      }
      return next;
    });
    if (p.name) setCustomer((c) => (c.trim() ? c : p.name as string));
  }, [template]);

  const reset = useCallback(() => {
    setValues(initialValues(template?.inputs ?? [], init.params));
    setMargin(String(init.margin ?? 0));
  }, [template, init.params, init.margin]);

  return {
    template, templateId, pickTemplate, values, setValue, started, sender, setSender, applyProposal, reset,
    margin, setMargin, customer, setCustomer, accountId, setAccountId, contactId, setContactId, notes, setNotes, customData, setCustomData,
  };
}

export type EstimateDraft = ReturnType<typeof useEstimateDraft>;
