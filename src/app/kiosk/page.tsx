import type { Metadata, Viewport } from "next";
import KioskClient from "./KioskClient";

// The attendance kiosk — a wall tablet running this page fullscreen.
// Deliberately OUTSIDE the (app) group: no Shell, no sidebar, no user
// session (middleware lets /kiosk through; the device token entered once
// on the setup screen is the credential for every API call it makes).
export const metadata: Metadata = { title: "Attendance Kiosk" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function KioskPage() {
  return <KioskClient />;
}
