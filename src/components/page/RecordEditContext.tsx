"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type RecordEdit = {
  /** An Edit request is waiting for a field editor to pick it up. */
  pending: boolean;
  request: () => void;
  consume: () => void;
};

const Ctx = createContext<RecordEdit | null>(null);

/**
 * Lets the record page's "⋯ > Edit" start the inline editor that lives in the
 * Overview tab (ObjectSections), across the server/client boundary and even
 * when the user is on another tab at the time: the request is held until an
 * editor mounts and takes it. Outside a provider useRecordEdit() is null and
 * ObjectSections keeps its own Edit button, so every existing screen is
 * unchanged.
 */
export function RecordEditProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState(false);
  const request = useCallback(() => setPending(true), []);
  const consume = useCallback(() => setPending(false), []);
  const value = useMemo(() => ({ pending, request, consume }), [pending, request, consume]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecordEdit(): RecordEdit | null {
  return useContext(Ctx);
}
