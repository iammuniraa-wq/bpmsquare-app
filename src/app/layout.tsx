import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import ThemeApplier from "@/components/ThemeApplier";
import { isPrimaryOrDevHost } from "@/lib/constants";
import { getTenantBrandingByHost } from "@/lib/tenant";

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host")?.split(":")[0] ?? "";
  const branding = isPrimaryOrDevHost(host) ? null : await getTenantBrandingByHost(host);
  const title = branding?.name ?? "BPMSquare";

  return {
    title,
    description: "CRM + Field Service for electromechanical repair & service businesses.",
    manifest: "/manifest.json",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <style>{`
          .card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
          .fg2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
          .fg3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
          .mob-show { display: none !important; }
          @media (max-width: 1000px) { .card-grid { grid-template-columns: repeat(2, 1fr); } }
          @media (max-width: 780px) {
            .mob-hide     { display: none !important; }
            .mob-show     { display: flex !important; }
            .mob-truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 100%; }
            .kpi-grid     { grid-template-columns: 1fr 1fr !important; }
            .hub-grid     { grid-template-columns: 1fr !important; }
            .card-grid    { grid-template-columns: 1fr 1fr !important; }
            .fg2, .fg3    { grid-template-columns: 1fr !important; gap: 12px !important; }
            .contact-actions { display: none !important; }
          }
          @media (max-width: 480px) {
            .card-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </head>
      <body>
        <ThemeApplier />
        {children}
      </body>
    </html>
  );
}
