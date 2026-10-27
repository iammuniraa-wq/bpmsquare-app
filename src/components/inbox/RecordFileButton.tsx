"use client";

import { useFeel } from "@/components/FeelProvider";
import s from "./inbox.module.css";

/** A file copied onto a record from an email: asks the server for a short-lived signed link, then opens or downloads it. */
export default function RecordFileButton({ id, name, note, image }: { id: string; name: string; note: string; image: boolean }) {
  const { toast } = useFeel();
  async function open() {
    try {
      const res = await fetch(`/api/inbox/files/${id}`);
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) { toast({ text: json.error ?? "That file could not be opened.", tone: "error" }); return; }
      if (image) window.open(json.url, "_blank", "noopener,noreferrer");
      else window.location.assign(json.url);
    } catch {
      toast({ text: "Could not reach the server. Try again.", tone: "error" });
    }
  }
  return (
    <button type="button" className={s.file} onClick={open} aria-label={`Open ${name}`}>
      <span className={s.fileName}><span>{name}</span><span className={s.fileNote}>{note}</span></span>
    </button>
  );
}
