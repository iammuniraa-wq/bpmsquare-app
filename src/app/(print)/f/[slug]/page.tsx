import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicPage } from "@/lib/marketing/forms/publicPage";
import PublicFormView from "@/components/marketing/PublicFormView";

export const metadata: Metadata = { title: "Contact form", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// The hosted form: <tenant origin>/f/<slug>. No login. The tenant comes from the host the page is
// served on and the form from that tenant's slug (publicPage.ts); a draft form, another
// workspace's slug and a workspace without the marketing_forms flag all answer "not found".
// ?embed=1 is the iframe on the client's website: the same form without the page chrome.
export default async function HostedFormPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ embed?: string }> }) {
  const { slug } = await params;
  const { embed } = await searchParams;
  const page = await loadPublicPage(slug);
  if (!page) notFound();
  return <PublicFormView form={page.form} brand={page.brand} embed={embed === "1"} />;
}
