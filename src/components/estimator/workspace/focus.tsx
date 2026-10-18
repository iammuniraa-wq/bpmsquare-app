"use client";

import { createContext, useContext } from "react";

/**
 * Lets the bill of materials point at the villa: "Show in 3D" on a line lights
 * that line's pieces in the model and scrolls to it. Absent outside the working
 * page, where the link simply is not offered.
 */
export type EstimateFocus = { highlightCode: string | null; show: (code: string) => void };

export const EstimateFocusContext = createContext<EstimateFocus | null>(null);

export const useEstimateFocus = () => useContext(EstimateFocusContext);
