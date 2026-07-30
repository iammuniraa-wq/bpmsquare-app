"use client";

import { Suspense } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";

function Toggle() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mode = searchParams.get("view") ?? "card";

  const href = (v: string) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set("view", v);
    return `${pathname}?${p.toString()}`;
  };

  return (
    <div style={{
      display: "flex", gap: 2,
      background: "var(--panel2)", borderRadius: 7, padding: 2,
      border: "1px solid var(--line)",
    }}>
      {(["card", "list"] as const).map((v) => (
        <Link key={v} href={href(v)} style={{
          width: 32, height: 28, borderRadius: 5, textDecoration: "none",
          background: mode === v ? "var(--panel)" : "transparent",
          color: mode === v ? "#1c2733" : "#9aacbc",
          fontSize: 15,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: mode === v ? "0 1px 3px rgba(0,0,0,.1)" : "none",
          transition: "all .1s",
        }}>
          {v === "card" ? "⊞" : "≡"}
        </Link>
      ))}
    </div>
  );
}

export default function ViewToggle() {
  return (
    <Suspense fallback={<div style={{ width: 68, height: 32 }} />}>
      <Toggle />
    </Suspense>
  );
}
