import Link from "next/link";

export type ButtonVariant = "primary" | "secondary" | "danger" | "quiet";
export type ButtonSize = "sm" | "md";

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  /** Disables the control and shows a spinner in place of the icon. */
  loading?: boolean;
  /** Square, label-less button (the label becomes the aria-label). */
  iconOnly?: boolean;
  children?: React.ReactNode;
};

type AsButton = Common & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { href?: undefined };
type AsLink = Common & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href"> & { href: string };

export type ButtonProps = AsButton | AsLink;

// A client-side <Link> prefetches, which is wrong for an API route (a PDF
// endpoint would be generated just because the link scrolled into view) and
// pointless for a new tab or download -- those get a plain anchor.
function needsPlainAnchor(href: string, target?: string, download?: unknown): boolean {
  return href.startsWith("/api/") || !href.startsWith("/") || !!target || download !== undefined;
}

/**
 * The one button. Heights are fixed per size (sm 30px, md 36px) so a row of
 * mixed buttons lines up; every colour and state lives in the `.bpm-btn*`
 * rules in globals.css so it follows the theme and both colour modes.
 */
export default function Button(props: ButtonProps) {
  const { variant = "secondary", size = "md", icon, loading, iconOnly, children, className, ...rest } = props;
  const cls = [
    "bpm-btn", `bpm-btn-${variant}`, `bpm-btn-${size}`, iconOnly ? "bpm-btn-icon" : "", className ?? "",
  ].filter(Boolean).join(" ");
  const lead = loading ? <span className="bpm-spin" aria-hidden="true" /> : icon;

  if ("href" in rest && typeof rest.href === "string") {
    const { href, target, rel, download, ...anchor } = rest as Omit<AsLink, keyof Common | "className">;
    const body = <>{lead}{children}</>;
    if (needsPlainAnchor(href, target, download)) {
      return (
        <a
          {...anchor}
          href={href}
          target={target}
          download={download}
          rel={target === "_blank" ? (rel ?? "noopener noreferrer") : rel}
          className={cls}
          aria-disabled={loading || undefined}
        >
          {body}
        </a>
      );
    }
    return (
      <Link {...anchor} href={href} className={cls} aria-disabled={loading || undefined}>
        {body}
      </Link>
    );
  }

  const { type = "button", disabled, ...button } = rest as Omit<AsButton, keyof Common | "className">;
  return (
    <button {...button} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined}>
      {lead}
      {children}
    </button>
  );
}
