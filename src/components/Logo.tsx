import { c } from "@/lib/theme";

// V monogram — two strokes converge on a single amber hub dot, echoing the
// data model (everything points to one hub/account). PROJECT.md §5.
export default function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-label="VeveyCRM">
      <rect width="96" height="96" rx="22" fill={c.accent} />
      <path
        d="M29 29 L48 63 L67 29"
        fill="none"
        stroke="#fff"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="48" cy="63" r="8.5" fill={c.amber} />
    </svg>
  );
}
