"use client";

import { useRef, useState } from "react";
import { c } from "@/lib/theme";
import type { CasePhoto } from "@/lib/types";

type Stage = CasePhoto["stage"];

type Props = {
  caseId: string;
  stage: Stage;
  existingPhotos: CasePhoto[];
  onUploaded: () => void;
};

type Preview = {
  file: File;
  objectUrl: string;
  caption: string;
  status: "pending" | "uploading" | "done" | "error";
  errorMsg?: string;
  result?: CasePhoto;
};

export default function PhotoUploader({ caseId, stage, existingPhotos, onUploaded }: Props) {
  const inputRef               = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [uploading, setUploading] = useState(false);

  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const next: Preview[] = files.map((f) => ({
      file:      f,
      objectUrl: URL.createObjectURL(f),
      caption:   "",
      status:    "pending",
    }));
    setPreviews((p) => [...p, ...next]);
    // reset so same file can be re-selected
    e.target.value = "";
  }

  function setCaption(idx: number, caption: string) {
    setPreviews((p) => p.map((item, i) => i === idx ? { ...item, caption } : item));
  }

  function removePreview(idx: number) {
    setPreviews((p) => {
      URL.revokeObjectURL(p[idx].objectUrl);
      return p.filter((_, i) => i !== idx);
    });
  }

  async function uploadAll() {
    const pending = previews.filter((p) => p.status === "pending");
    if (!pending.length) return;
    setUploading(true);

    for (let i = 0; i < previews.length; i++) {
      if (previews[i].status !== "pending") continue;
      setPreviews((p) => p.map((item, j) => j === i ? { ...item, status: "uploading" } : item));

      const fd = new FormData();
      fd.append("file",    previews[i].file);
      fd.append("stage",   stage);
      fd.append("caption", previews[i].caption);

      const res = await fetch(`/api/cases/${caseId}/photos`, { method: "POST", body: fd });

      if (res.ok) {
        const photo: CasePhoto = await res.json();
        setPreviews((p) => p.map((item, j) =>
          j === i ? { ...item, status: "done", result: photo } : item
        ));
      } else {
        const j = await res.json().catch(() => ({ error: "Upload failed" }));
        setPreviews((p) => p.map((item, k) =>
          k === i ? { ...item, status: "error", errorMsg: j.error ?? "Upload failed" } : item
        ));
      }
    }

    setUploading(false);
    onUploaded();
  }

  const pendingCount = previews.filter((p) => p.status === "pending").length;

  return (
    <div>
      {/* Existing uploaded photos */}
      {existingPhotos.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
          gap: 8, marginBottom: 12,
        }}>
          {existingPhotos.map((photo) => (
            <div key={photo.id} style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${c.line}`, background: c.panel2 }}>
              <img
                src={photo.url}
                alt={photo.caption || "Case photo"}
                style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }}
              />
              {photo.caption && (
                <div style={{ padding: "4px 6px", fontSize: 10.5, color: c.muted, lineHeight: 1.3 }}>
                  {photo.caption}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Staged previews */}
      {previews.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {previews.map((p, i) => (
            <div key={i} style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              background: p.status === "error" ? "#fef2f2" : c.panel2,
              borderRadius: 8, padding: 8,
              border: `1px solid ${p.status === "error" ? "#fecaca" : c.line}`,
            }}>
              <img
                src={p.objectUrl}
                alt=""
                style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: c.muted, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.file.name}
                </div>
                {p.status === "pending" && (
                  <input
                    style={{
                      width: "100%", padding: "5px 8px", fontSize: 12,
                      border: `1px solid ${c.line}`, borderRadius: 6,
                      background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
                    }}
                    placeholder="Caption (optional)"
                    value={p.caption}
                    onChange={(e) => setCaption(i, e.target.value)}
                  />
                )}
                {p.status === "uploading" && (
                  <div style={{ fontSize: 12, color: c.accent }}>Uploading…</div>
                )}
                {p.status === "done" && (
                  <div style={{ fontSize: 12, color: "#1d9e75", fontWeight: 600 }}>✓ Uploaded</div>
                )}
                {p.status === "error" && (
                  <div style={{ fontSize: 12, color: "#dc2626" }}>{p.errorMsg}</div>
                )}
              </div>
              {p.status === "pending" && (
                <button
                  onClick={() => removePreview(i)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: c.hint, fontSize: 16, padding: "2px 4px", flexShrink: 0 }}
                  type="button"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {/* Hidden input — no capture attr so mobile shows "Camera / Gallery" choice sheet */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={onFilesSelected}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          style={{
            flex: 1, padding: "10px 14px", borderRadius: 8,
            border: `1.5px dashed ${c.accent}`,
            background: c.accentbg, color: c.accent,
            fontWeight: 600, fontSize: 13, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          }}
        >
          <span style={{ fontSize: 18 }}>📷</span>
          {existingPhotos.length > 0 ? "Add more photos" : "Add photos"}
        </button>

        {pendingCount > 0 && (
          <button
            type="button"
            onClick={uploadAll}
            disabled={uploading}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 8,
              border: "none", background: c.accent, color: "#fff",
              fontWeight: 700, fontSize: 13, cursor: uploading ? "wait" : "pointer",
            }}
          >
            {uploading ? "Uploading…" : `Upload ${pendingCount} photo${pendingCount > 1 ? "s" : ""}`}
          </button>
        )}
      </div>

      <div style={{ fontSize: 11, color: c.hint, marginTop: 6 }}>
        On mobile tap "Add photos" → choose <strong>Camera</strong> to shoot or <strong>Photos</strong> to pick from gallery. Max 10 MB each.
      </div>
    </div>
  );
}
