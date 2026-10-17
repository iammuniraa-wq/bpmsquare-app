import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import FormFooter from "@/components/ui/FormFooter";

/**
 * The shared create / edit page: back link, title (+ optional subtitle), the
 * caller's sections as `Card`s with `Field`s, and the sticky Cancel / Save
 * footer. Custom and newly-added standard fields come from the caller mounting
 * `CreateExtraFields` as one more section.
 *
 * The caller owns the form state and passes `onSubmit`; this component only
 * lays out the page, so it works from any client form without changing how
 * that form validates or saves.
 */
export default function ObjectFormPage({
  backHref, backLabel, title, subtitle, onSubmit, saving = false, saveLabel, error, cancelHref, footerLeft, headerAction, maxWidth = 820, children,
}: {
  backHref: string;
  /** "All suppliers" -- the arrow is added here. */
  backLabel: string;
  title: string;
  subtitle?: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  saving?: boolean;
  saveLabel?: string;
  error?: string;
  /** Defaults to `backHref`. */
  cancelHref?: string;
  footerLeft?: React.ReactNode;
  /** Top-right of the header, for the rare form with its own control (the Adapt-fields drawer). */
  headerAction?: React.ReactNode;
  maxWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Link href={backHref} className="bpm-backlink">
          ← {backLabel}
        </Link>
      </div>

      <PageHeader title={title} subtitle={subtitle} action={headerAction} />

      <form onSubmit={onSubmit} className="bpm-form-page" style={{ maxWidth }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>

        {error && (
          <div
            role="alert"
            style={{ marginTop: 14, background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--err-ink)" }}
          >
            {error}
          </div>
        )}

        <FormFooter cancelHref={cancelHref ?? backHref} saving={saving} saveLabel={saveLabel} left={footerLeft} />
      </form>
    </>
  );
}
