import { hostOfUrl } from "../companyKey";

// Where a name and title may come from besides the company's own site (owner decision 2026-11-23, company brief). A
// company-issued filing or press release is often hosted by an exchange, a regulator or a newswire, not on the company's own
// domain, so the people part would otherwise lose every annual report and appointment notice. This is the whole list: short,
// fixed, one place, easy to extend. A host here is trusted only to HOST what the company issued: the validator still requires
// the page's cited title or snippet to name the company, and a name is still only ever a name and a title.
//
// Add a host by adding one line. Match is the host itself or any sub-domain of it; "www." is ignored.

export const PUBLISHER_HOSTS: readonly string[] = [
  // Exchanges (Gulf first: where the product's clients and prospects are listed).
  "saudiexchange.sa", "tadawul.com.sa", "adx.ae", "dfm.ae", "nasdaqdubai.com", "qe.com.qa", "boursakuwait.com.kw", "bahrainbourse.com",
  "msx.om", "egx.com.eg", "londonstockexchange.com", "nseindia.com", "bseindia.com",
  // Regulators and registries.
  "cma.org.sa", "sca.gov.ae", "sec.gov", "find-and-update.company-information.service.gov.uk", "fca.org.uk",
  // Newswires.
  "prnewswire.com", "businesswire.com", "globenewswire.com", "accesswire.com", "zawya.com",
];

/** Whether the url is on an exchange, regulator or newswire host from the list. Https only. */
export function onPublisherHost(url: string): boolean {
  try { if (new URL(url).protocol !== "https:") return false; } catch { return false; }
  const host = hostOfUrl(url);
  return !!host && PUBLISHER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

// Sites that aggregate or sell people's contact details, and social networks. They are blocked from every search so a
// result page never offers a person's profile or a private contact detail to the model (company brief rule 5).
export const BLOCKED_SEARCH_DOMAINS: readonly string[] = [
  "linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "youtube.com", "snapchat.com", "pinterest.com", "reddit.com",
  "rocketreach.co", "zoominfo.com", "apollo.io", "lusha.com", "signalhire.com", "contactout.com", "hunter.io", "seamless.ai", "clearbit.com",
  "spokeo.com", "whitepages.com", "beenverified.com", "intelius.com", "peekyou.com", "radaris.com",
];
