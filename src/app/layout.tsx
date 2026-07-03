import type { Metadata } from "next";
import "./globals.css";
import ThemeApplier from "@/components/ThemeApplier";

export const metadata: Metadata = {
  title: "VeveyCRM — Vikas Pioneers workspace",
  description: "CRM + Field Service for electromechanical repair & service businesses.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "VeveyCRM" },
};

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
