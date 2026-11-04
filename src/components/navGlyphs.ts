import type React from "react";
import { ROUTES } from "@/lib/constants";
import {
  Gear, Monitor, Globe, Phone, FileText, BarChart2, Activity, Wrench, MapPin, Mail, Package, LinkIcon, Clock, Users,
  CheckIcon, Database, Box, Shield, Tag, Truck, Filter, Coins, Zap, MessageSquare,
  Home, InboxTray, Compass, Wallet, Kanban, Calculator, Fence, ArrowLeftRight, FileStack, ShoppingCart, ShoppingBag,
  Briefcase, Receipt, LifeBuoy, Repeat, HardHat, Megaphone, Target, Send, Calendar, CalendarCheck, FormIcon, Route,
  Radio, Gauge, TrendingUp, IdCard, Eye, Folder, Sun, Timer, ArrowUpDown, Sliders, PieChart, Hourglass,
} from "@/components/Icons";

export type GlyphComponent = React.ComponentType<{ size?: number; color?: string }>;

/**
 * One distinct SVG glyph per nav destination. Kept out of Sidebar.tsx so
 * Spaces, the Nova rail and the mobile tab bar can all draw the same glyph
 * without importing the whole sidebar; Sidebar re-exports NAV_GLYPHS.
 *
 * Rules (enforced by navGlyphs.test.ts): every NAV href has an entry, no two
 * destinations in one NAV group share a glyph, and Gear belongs to Settings
 * alone -- Gear is what a missing entry used to fall back to, which made
 * Estimates, RFQs, Sales Orders and others read as "Settings".
 */
export const NAV_GLYPHS: Record<string, GlyphComponent> = {
  // Workspace
  [ROUTES.dashboard]: Monitor,
  [ROUTES.inbox]: InboxTray,
  [ROUTES.processStudio]: Compass,
  // Sales & procurement
  [ROUTES.pipeline]: Kanban,
  [ROUTES.estimates]: Calculator,
  [ROUTES.fenceProjects]: Fence,
  [ROUTES.rfqs]: ArrowLeftRight,
  [ROUTES.quotations]: FileText,
  [ROUTES.standardQuotes]: FileStack,
  [ROUTES.salesOrders]: ShoppingCart,
  [ROUTES.purchaseOrders]: ShoppingBag,
  [ROUTES.contractProjects]: Briefcase,
  [ROUTES.invoices]: Receipt,
  // Service
  [ROUTES.cases]: Activity,
  [ROUTES.amc]: Repeat,
  [ROUTES.workOrders]: Wrench,
  [ROUTES.dispatch]: MapPin,
  [ROUTES.technicians]: HardHat,
  // Marketing and Intelligence (two groups, docs/design/marketing-two-parts.md)
  [ROUTES.marketingSegments]: Filter,
  [ROUTES.marketingAbm]: Target,
  [ROUTES.marketingEmail]: Send,
  [ROUTES.marketing]: Send,
  [ROUTES.marketingNewsletters]: Mail,
  [ROUTES.marketingWhatsapp]: MessageSquare,
  [ROUTES.marketingEvents]: CalendarCheck,
  [ROUTES.marketingForms]: FormIcon,
  [ROUTES.marketingJourneys]: Route,
  [ROUTES.marketingSignals]: Radio,
  [ROUTES.leads]: Zap,
  [ROUTES.marketingLeads]: Gauge,
  [ROUTES.marketingAttribution]: TrendingUp,
  // Master data
  [ROUTES.accounts]: Globe,
  [ROUTES.contacts]: Phone,
  [ROUTES.partners]: LinkIcon,
  [ROUTES.suppliers]: Truck,
  [ROUTES.products]: Tag,
  [ROUTES.inventory]: Package,
  [ROUTES.assets]: Box,
  [ROUTES.employees]: IdCard,
  // Workforce
  [ROUTES.wfmMe]: Clock,
  [ROUTES.wfmLiveBoard]: Eye,
  [ROUTES.wfmEmployees]: Users,
  [ROUTES.wfmCorrections]: CheckIcon,
  [ROUTES.wfmRoster]: Calendar,
  [ROUTES.wfmProjects]: Folder,
  [ROUTES.wfmLeave]: Sun,
  [ROUTES.wfmSummary]: Timer,
  // Insights
  [ROUTES.reports]: BarChart2,
  [ROUTES.pricingToday]: Coins,
  // Admin
  [ROUTES.dataWorkbench]: ArrowUpDown,
  [ROUTES.administration]: Shield,
  [ROUTES.settings]: Gear,
};

/** The tile for each NAV group in Spaces and the mobile tab bar. Each is
 * different from every other tile and from the group's own first item. */
export const GROUP_ICON: Record<string, GlyphComponent> = {
  "WORKSPACE": Home,
  "SALES & PROCUREMENT": Wallet,
  "SERVICE": LifeBuoy,
  "MARKETING": Megaphone,
  "INTELLIGENCE": Compass,
  "MASTER DATA": Database,
  "WORKFORCE": Hourglass,
  "INSIGHTS": PieChart,
  "ADMIN": Sliders,
};
