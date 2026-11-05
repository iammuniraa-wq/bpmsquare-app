export type PhotoMesh = "a" | "b" | "c" | "d" | "e" | "f";

/**
 * A rounded image frame (docs/design/rich-ui.md, principle 3). Until a tenant or customer image exists it paints a soft gradient
 * mesh from the Rich tokens (--rich-m0..m4, see src/styles/rich.css; a plain tint without them). Children float over it, typically a
 * small glass card. Pass `src` later and the same frame holds the picture, with the mesh as its loading colour. Presentational only.
 */
export default function PhotoFrame({ mesh = "a", radius = 24, height = 190, src, alt = "", children, style }: {
  mesh?: PhotoMesh;
  radius?: 24 | 32;
  height?: number | string;
  /** A real image. Omit it for the gradient stand-in. */
  src?: string;
  /** Empty (decorative) by default; give it when the picture says something. */
  alt?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rich-photo rich-photo--${mesh}`}
      data-mesh={mesh}
      style={{ position: "relative", overflow: "hidden", isolation: "isolate", borderRadius: radius, height, background: "var(--rich-m0, var(--panel2))", ...style }}
    >
      {src && <img src={src} alt={alt} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: -1 }} />}
      {children}
    </div>
  );
}
