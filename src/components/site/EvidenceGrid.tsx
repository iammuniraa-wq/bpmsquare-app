import { c } from "@/lib/theme";

type FileRow = { id: string; kind: string; mime_type: string | null; size_bytes: number | null; created_at: string };

/**
 * The photos, the signature and any PDF of a site record. Each opens through /api/site/files/[id], which checks the person may see the record and
 * answers a 60-second signed link; nothing here is a public address.
 */
export default function EvidenceGrid({ files, empty }: { files: FileRow[]; empty: string }) {
  if (files.length === 0) return <div style={{ fontSize: 13, color: c.hint }}>{empty}</div>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {files.map((f) => {
        const href = `/api/site/files/${f.id}`;
        const isPdf = f.mime_type === "application/pdf";
        return (
          <a key={f.id} href={href} target="_blank" rel="noopener noreferrer" style={{ display: "flex", flexDirection: "column", gap: 4, textDecoration: "none", color: c.muted, fontSize: 12 }}>
            {isPdf ? (
              <span style={{ width: 120, height: 120, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${c.line}`, borderRadius: 10, background: c.panel2, fontWeight: 700 }}>PDF</span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={href} alt={f.kind === "signature" ? "Signature" : "Photo"} loading="lazy" style={{ width: 120, height: 120, objectFit: "cover", border: `1px solid ${c.line}`, borderRadius: 10, background: "white" }} />
            )}
            <span>{f.kind === "signature" ? "Signature" : isPdf ? "Document" : "Photo"}</span>
          </a>
        );
      })}
    </div>
  );
}
