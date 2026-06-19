import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VeveyCRM — Vikas Pioneers workspace",
  description:
    "CRM + Field Service for electromechanical repair & service businesses.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
