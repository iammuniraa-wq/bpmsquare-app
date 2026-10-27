import type { TemplateIconKey } from "@/lib/estimator/templateCard";

/** SVG-only icons for a template card. They draw in the current text colour. */
export default function TemplateIcon({ name, size = 28 }: { name: TemplateIconKey; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 32 32", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "fence":
      return (
        <svg {...common}>
          <path d="M5 26V8M13 26V8M21 26V8M29 26V8" />
          <path d="M3 12h28M3 20h28" strokeWidth={1.2} />
          <path d="M5 12l8 8M13 12l8 8M21 12l8 8M13 12L5 20M21 12l-8 8M29 12l-8 8" strokeWidth={0.9} opacity={0.6} />
        </svg>
      );
    case "building":
      return (
        <svg {...common}>
          <path d="M4 28h24M7 28V14l9-7 9 7v14" />
          <path d="M13 28v-7h6v7M11 16h2.5M18.5 16H21" />
        </svg>
      );
    case "tiles":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="10" height="10" rx="1" />
          <rect x="18" y="4" width="10" height="10" rx="1" />
          <rect x="4" y="18" width="10" height="10" rx="1" />
          <rect x="18" y="18" width="10" height="10" rx="1" />
        </svg>
      );
    case "cabin":
      return (
        <svg {...common}>
          <rect x="4" y="9" width="24" height="15" rx="1.5" />
          <path d="M4 24v3M28 24v3M9 14h4v5H9zM17 14h6M17 19h6" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M5 8h22M5 16h22M5 24h14" />
          <circle cx="25" cy="24" r="2.5" />
        </svg>
      );
  }
}
