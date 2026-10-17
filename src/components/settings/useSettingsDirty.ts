"use client";

import { useState } from "react";

/**
 * Has this page's editable state changed since it was loaded (or last saved)?
 * Compares a JSON snapshot, so it needs no per-field bookkeeping: pass the
 * object that gets sent to the server, call `markSaved(sent)` after a
 * successful save.
 */
export function useSettingsDirty<T>(value: T): { dirty: boolean; markSaved: (saved?: T) => void } {
  const [base, setBase] = useState(() => JSON.stringify(value));
  return {
    dirty: JSON.stringify(value) !== base,
    markSaved: (saved?: T) => setBase(JSON.stringify(saved === undefined ? value : saved)),
  };
}
