import Link from "next/link";
import { notFound } from "next/navigation";
import { getContactLive } from "@/lib/data/live";
import { getUserRole, getTenant } from "@/lib/tenant";
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL } from "@/lib/data";
import { c, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import Card from "@/components/ui/Card";
import { ROUTES } from "@/lib/constants";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import ExternalRecordSlot from "@/components/ExternalRecordSlot";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActivity from "@/components/page/RecordActivity";
import RelatedList from "@/components/page/RelatedList";
import ContactDetailSections from "./ContactDetailSections";
import ContactMarketingTab from "./ContactMarketingTab";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { canEditWorkcenter, resolvePermissions } from "@/lib/permissions";
import { emailHealthOn, loadContactHealth, type ContactHealth } from "@/lib/marketing/contactHealth";
import { EMAIL_STATUS_COPY, needsAttention } from "@/lib/marketing/emailHealth";
import { marketingScoringOn } from "@/lib/marketing/config";
import { loadContactConsent, type ContactConsent } from "@/lib/marketing/contactConsent";

const CASE_TONE: Record<string, PillarKey> = {
  intake: "blue", inspection: "teal",
  report_sent: "amber", report_approved: "green",
  quote_sent: "amber", quote_approved: "green",
  in_repair: "amber", qa: "teal",
  ready: "green", closed: "green",
  buyback: "purple", scrapped: "red",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default async function ContactDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const [data, role, tenant] = await Promise.all([getContactLive(id), getUserRole(), getTenant()]);
  if (!data) notFound();
  const { contact, account, cases } = data;
  const isAdmin = role === "admin";
  const casesOn = tenant?.features?.cases === true;
  const healthOn = emailHealthOn(tenant?.features);
  const consentOn = marketingScoringOn(tenant?.features);
  const marketingTabOn = healthOn || consentOn;
  let canEditMarketing = false;
  let health: ContactHealth | null = null;
  let consent: ContactConsent | null = null;
  if (marketingTabOn) {
    const { supabase, tenantId, userId, role: memberRole } = await requireTenantUser();
    canEditMarketing = canEditWorkcenter(await resolvePermissions(supabase, tenantId, userId, memberRole), "contacts");
    const admin = createAdminSupabase();
    [health, consent] = await Promise.all([
      healthOn ? loadContactHealth(admin, tenantId, contact.id) : Promise.resolve(null),
      consentOn ? loadContactConsent(admin, tenantId, contact.id) : Promise.resolve(null),
    ]);
  }
  const basePath = ROUTES.contact(contact.id);
  const openCases = cases.filter((sc) => !["closed", "buyback", "scrapped"].includes(sc.status));
  const newCaseHref = account ? `${ROUTES.caseNew}?account_id=${account.id}` : undefined;

  return (
    <ObjectRecordPage
      backHref={ROUTES.contacts}
      backLabel="All contacts"
      title={contact.name}
      reference={contact.ref}
      meta={contact.role ?? undefined}
      menu={
        <RecordMoreMenu
          inlineEdit={{ overviewHref: basePath }}
          adapt={{ objectType: "contact", objectLabel: "Contact", isAdmin }}
        />
      }
      facts={[
        { label: "Account", value: account ? <Link href={ROUTES.account(account.id)} style={{ color: c.accent, textDecoration: "none" }}>{account.name}</Link> : "—" },
        { label: "Phone", value: contact.phone ? <a href={`tel:${contact.phone}`} style={{ color: "inherit", textDecoration: "none" }}>{contact.phone}</a> : "—" },
        { label: "Email", value: contact.email ? (
          <>
            <a href={`mailto:${contact.email}`} style={{ color: c.accent, textDecoration: "none" }}>{contact.email}</a>
            {health?.available && needsAttention(health.status) && (
              <> <Link href={`${basePath}?tab=marketing`} style={{ textDecoration: "none" }}><StatusPill label={EMAIL_STATUS_COPY[health.status].label} tone={EMAIL_STATUS_COPY[health.status].tone} /></Link></>
            )}
          </>
        ) : "—" },
        ...(account?.city ? [{ label: "City", value: account.city }] : []),
      ]}
      externalLine={<ExternalRecordSlot objectType="contacts" objectId={contact.id} />}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        {
          id: "overview",
          label: "Overview",
          content: <ContactDetailSections contact={contact} accountAddress={account ?? null} />,
        },
        ...(marketingTabOn ? [{
          id: "marketing",
          label: "Marketing",
          content: <ContactMarketingTab contactId={contact.id} email={contact.email} canEdit={canEditMarketing} health={health} consent={consent} />,
        }] : []),
        ...(casesOn ? [{
          id: "cases",
          label: "Cases",
          count: cases.length,
          content: (
            <RelatedList
              title={`Cases${openCases.length > 0 ? ` · ${openCases.length} open` : ""}`}
              newHref={newCaseHref}
              newLabel="Case"
              emptyText="No cases linked to this contact yet."
              rows={cases}
              rowKey={(sc) => sc.id}
              rowHref={(sc) => ROUTES.case(sc.id)}
              columns={[
                { label: "Ref", render: (sc) => <span style={{ fontWeight: 600, color: c.ink }}>{sc.ref}</span> },
                { label: "Stage", render: (sc) => <StatusPill label={CASE_STATUS_LABEL[sc.status]} tone={CASE_TONE[sc.status] ?? "blue"} /> },
                { label: "Type", render: (sc) => <StatusPill label={CASE_TYPE_LABEL[sc.type]} tone="blue" /> },
                { label: "Equipment", cellStyle: { color: c.muted }, render: (sc) => sc.equipment_label || "—" },
                { label: "Complaint", cellStyle: { maxWidth: 220, color: c.muted, fontSize: 12.5 }, render: (sc) => (
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{sc.complaint || "—"}</span>
                ) },
                { label: "Intake", cellStyle: { color: c.hint, fontSize: 12, whiteSpace: "nowrap" }, render: (sc) => fmtDate(sc.intake_at) },
              ]}
            />
          ),
        }] : []),
        {
          id: "activity",
          label: "Activity",
          content: <RecordActivity objectType="contacts" objectId={contact.id} isAdmin={isAdmin} />,
        },
      ]}
      rail={account ? (
        <Card title="Account" padding={14}>
          <Link href={ROUTES.account(account.id)} style={{ color: c.accent, fontWeight: 600, fontSize: 13.5, textDecoration: "none" }}>
            {account.name}
          </Link>
          {account.city && <div style={{ fontSize: 12.5, color: c.muted, marginTop: 4 }}>{account.city}</div>}
        </Card>
      ) : undefined}
    />
  );
}
