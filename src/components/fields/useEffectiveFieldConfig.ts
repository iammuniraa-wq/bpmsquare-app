"use client";

import { useCallback, useEffect, useState } from "react";
import type { EffectiveField, FieldRule } from "@/lib/fieldRegistry";

export type FieldConfigSection = { label: string; fields: EffectiveField[] };
export type FieldConfig = { sections: FieldConfigSection[]; rules: FieldRule[] };

const EMPTY: FieldConfig = { sections: [], rules: [] };

/**
 * Fetches the merged, effective field configuration (standard registry
 * fields + custom fields + tenant field_overrides + field_rules) for an
 * object type. Refetches whenever the existing "bpm:cf-changed" window
 * event fires — the same event AdaptObjectDrawer already dispatches on any
 * custom-field/override/rule change, so no new plumbing is needed to keep
 * an open detail/edit view in sync with a concurrently open Adapt drawer.
 */
export function useEffectiveFieldConfig(objectType: string) {
  const [config, setConfig] = useState<FieldConfig>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    setLoading(true);
    fetch(`/api/settings/field-config?object=${objectType}`)
      .then((r) => r.json())
      .then((data: FieldConfig) => setConfig(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [objectType]);

  useEffect(() => {
    refetch();
    const onChange = () => refetch();
    window.addEventListener("bpm:cf-changed", onChange);
    return () => window.removeEventListener("bpm:cf-changed", onChange);
  }, [refetch]);

  return { sections: config.sections, rules: config.rules, loading, refetch };
}
