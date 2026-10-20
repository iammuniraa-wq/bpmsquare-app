"use client";

import { useEffect, useId } from "react";
import Card from "@/components/ui/Card";

/** A small dialog over the page: Escape and a click outside close it. Phone-safe (90vw, scrolls). */
export default function Modal({ title, onClose, children, width = 460 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,32,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ width, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <Card padding={20}>
          <h2 id={titleId} className="bpm-t-section" style={{ margin: "0 0 12px" }}>{title}</h2>
          {children}
        </Card>
      </div>
    </div>
  );
}
