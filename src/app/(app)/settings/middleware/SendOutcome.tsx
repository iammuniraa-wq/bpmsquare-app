"use client";

import Button from "@/components/ui/Button";
import s from "./middleware.module.css";
import type { SendResult } from "./api";
import { ExternalIcon, Notice } from "./ui";

/** What a send did, in words: the readable number and a link, or what happened and the one thing to do. */
export function SendOutcome({ result }: { result: SendResult }) {
  if (!result.ok) {
    return <Notice tone="err"><span className={s.noticeStrong}>{result.headline}</span>{result.fix ? <> {result.fix}</> : null}</Notice>;
  }
  return (
    <Notice tone="ok" action={result.link ? <Button size="sm" href={result.link} target="_blank" icon={<ExternalIcon />}>Open</Button> : undefined}>
      {result.message}
    </Notice>
  );
}
