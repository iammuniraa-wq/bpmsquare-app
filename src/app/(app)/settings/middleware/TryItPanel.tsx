"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import type { TryResult } from "@/lib/middleware/mapping/types";
import s from "./middleware.module.css";
import { tryMapping, type MapDocumentKey } from "./api";
import Panel from "./Panel";
import { Notice, ProblemNotice } from "./ui";

/** What the saved mapping would send for a sample quote. Plain words first, the exact body behind a toggle. */
export function TryResultView({ result }: { result: TryResult }) {
  const [raw, setRaw] = useState(false);
  return (
    <>
      <ul className={s.words}>{result.words.map((w) => <li key={w}>{w}</li>)}</ul>
      {result.problems.map((p, i) => (
        <Notice key={`${p.code}${i}`} tone="warn">
          <span className={s.noticeStrong}>{p.message}</span> {p.fix}
        </Notice>
      ))}
      {result.problems.length === 0 && <Notice tone="ok">Nothing in the way: this quote can be sent.</Notice>}
      <div className={s.row}>
        <Button size="sm" aria-pressed={raw} onClick={() => setRaw((r) => !r)}>{raw ? "Hide the exact body" : "Show the exact body"}</Button>
      </div>
      {raw && (
        <pre className={s.raw} aria-label="The exact request">
          {`${result.request.method} ${result.request.url}\n${result.request.headers.join(", ")}\n\n${JSON.stringify(result.request.body, null, 2)}`}
        </pre>
      )}
    </>
  );
}

export default function TryItPanel({ connection, document, onClose }: { connection: string; document: MapDocumentKey; onClose: () => void }) {
  const [result, setResult] = useState<TryResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let live = true;
    tryMapping(connection, document)
      .then((r) => { if (live) setResult(r); })
      .catch((e) => { if (live) setError(e); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [connection, document]);

  return (
    <Panel title="Try it" subtitle="A sample quote through the saved mapping" onClose={onClose}>
      {busy && <div className={`${s.small} ${s.muted}`} role="status">Working…</div>}
      {error != null && <ProblemNotice error={error} />}
      {result && <TryResultView result={result} />}
    </Panel>
  );
}
