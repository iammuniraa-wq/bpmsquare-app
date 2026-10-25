// Minimal `$metadata` documents for the four order services, in the style of BP_METADATA / PRODUCT_METADATA in fakeS4.ts. They contain
// ONLY property names this product could verify from a source, so they describe what a SAP system is KNOWN to offer, not what its
// documentation may say it offers. The two sources, and what each one covers:
//
//   [R] a real A_SalesOrder response (SAP-samples/s4hana-ext-geo-report-app, src/test/resources/model/A_SalesOrder('69').json): the
//       header, item and navigation names of API_SALES_ORDER_SRV, and its type names (A_SalesOrderType, A_SalesOrderItemType).
//   [S] the generated client of API_SALES_ORDER_SIMULATION_SRV (ballerinax/sap.s4hana.api_sales_order_simulation_srv 2.1.0), which is
//       generated from that service's own $metadata: the simulation header, item, schedule line, credit and pricing names.
//
// NOT here (documented by SAP but never seen by this product): everything of API_OUTBOUND_DELIVERY_SRV and API_BILLING_DOCUMENT_SRV
// except the keys the code needs to ask a question, which are marked [D]. Their fixtures exist so the code path is tested end to end;
// the code never requires a [D] property -- it reads what the connected system lists (serviceMeta.ts) and says so when one is missing.

const wrap = (ns: string, body: string): string => `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"><edmx:DataServices><Schema Namespace="${ns}" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
${body}
</Schema></edmx:DataServices></edmx:Edmx>`;

const props = (names: string[], keys: string[] = []): string =>
  names.map((n) => `<Property Name="${n}" Type="Edm.String"${keys.includes(n) ? ' Nullable="false"' : ""}/>`).join("");
const nav = (names: string[]): string => names.map((n) => `<NavigationProperty Name="${n}" Relationship="x" FromRole="a" ToRole="b"/>`).join("");
const type = (name: string, keys: string[], names: string[], navs: string[] = []): string =>
  `<EntityType Name="${name}"><Key>${keys.map((k) => `<PropertyRef Name="${k}"/>`).join("")}</Key>${props(names, keys)}${nav(navs)}</EntityType>`;
const sets = (ns: string, entries: [string, string][]): string =>
  `<EntityContainer Name="E">${entries.map(([s, t]) => `<EntitySet Name="${s}" EntityType="${ns}.${t}"/>`).join("")}</EntityContainer>`;

// [R]
export const SALES_ORDER_HEADER_PROPS = [
  "SalesOrder", "CreationDate", "CreatedByUser", "LastChangeDate", "LastChangeDateTime", "PurchaseOrderByCustomer", "CustomerPurchaseOrderType",
  "CustomerPurchaseOrderDate", "SalesOrderDate", "TotalNetAmount", "TransactionCurrency", "SalesOrderType", "SDDocumentReason", "PricingDate",
  "RequestedDeliveryDate", "ShippingCondition", "CompleteDeliveryIsDefined", "ShippingType", "HeaderBillingBlockReason", "DeliveryBlockReason",
  "IncotermsClassification", "IncotermsTransferLocation", "SalesOrganization", "CustomerPaymentTerms", "PaymentMethod", "OverallSDProcessStatus",
  "TotalCreditCheckStatus", "OverallTotalDeliveryStatus", "OverallSDDocumentRejectionSts", "DistributionChannel", "OrganizationDivision", "SalesGroup",
  "SalesOffice", "SalesDistrict", "SoldToParty",
];
// [R]
export const SALES_ORDER_ITEM_PROPS = [
  "SalesOrder", "SalesOrderItem", "RequestedQuantity", "RequestedQuantityUnit", "ItemGrossWeight", "ItemNetWeight", "ItemWeightUnit", "ItemVolume", "ItemVolumeUnit",
  "TransactionCurrency", "NetAmount", "MaterialGroup", "Batch", "ProductionPlant", "StorageLocation", "ShippingPoint", "ShippingType", "DeliveryPriority",
  "IncotermsClassification", "IncotermsTransferLocation", "CustomerPaymentTerms", "SalesDocumentRjcnReason", "HigherLevelItem", "ItemBillingBlockReason",
  "SDProcessStatus", "DeliveryStatus", "OrderRelatedBillingStatus", "SalesOrderItemCategory", "SalesOrderItemText", "PurchaseOrderByCustomer", "Material",
  "MaterialByCustomer", "PricingDate",
];
// [S] -- the schedule line of the order itself is read with the simulation's names; they are the same fields of the same business object.
export const SCHEDULE_LINE_PROPS = [
  "SalesOrder", "SalesOrderItem", "ScheduleLine", "RequestedDeliveryDate", "ConfirmedDeliveryDate", "OrderQuantityUnit", "ScheduleLineOrderQuantity",
  "ConfdOrderQtyByMatlAvailCheck", "OpenConfdDelivQtyInOrdQtyUnit", "CorrectedQtyInOrderQtyUnit",
];

export const SALES_ORDER_METADATA = wrap("API_SALES_ORDER_SRV",
  type("A_SalesOrderType", ["SalesOrder"], SALES_ORDER_HEADER_PROPS, ["to_Item", "to_Partner", "to_PricingElement"]) +
  type("A_SalesOrderItemType", ["SalesOrder", "SalesOrderItem"], SALES_ORDER_ITEM_PROPS, ["to_Partner", "to_PricingElement", "to_SalesOrder", "to_ScheduleLine"]) +
  type("A_SalesOrderScheduleLineType", ["SalesOrder", "SalesOrderItem", "ScheduleLine"], SCHEDULE_LINE_PROPS) +
  sets("API_SALES_ORDER_SRV", [["A_SalesOrder", "A_SalesOrderType"], ["A_SalesOrderItem", "A_SalesOrderItemType"], ["A_SalesOrderScheduleLine", "A_SalesOrderScheduleLineType"]]));

// [S]
export const SIMULATION_HEADER_PROPS = [
  "SalesOrder", "SalesOrderType", "SalesOrganization", "DistributionChannel", "OrganizationDivision", "SalesGroup", "SalesOffice", "SalesDistrict", "SoldToParty",
  "CustomerGroup", "PurchaseOrderByCustomer", "CustomerPurchaseOrderType", "CustomerPurchaseOrderDate", "SalesOrderDate", "TransactionCurrency",
  "AccountingDocExternalReference", "PriceListType", "CustomerPriceGroup", "SDDocumentReason", "PricingDate", "SDPricingProcedure", "RequestedDeliveryDate",
  "ShippingCondition", "ShippingType", "IncotermsClassification", "ReferenceSDDocument", "CustomerPaymentTerms", "PaymentMethod", "CompleteDeliveryIsDefined",
];
export const SIMULATION_ITEM_PROPS = [
  "SalesOrder", "SalesOrderItem", "HigherLevelItem", "SalesOrderItemCategory", "SalesOrderItemText", "PurchaseOrderByCustomer", "Material", "MaterialByCustomer",
  "PricingDate", "RequestedQuantity", "RequestedQuantityUnit", "OrderQuantityUnit", "ConfdDelivQtyInOrderQtyUnit", "TransactionCurrency", "NetAmount", "TaxAmount",
  "CostAmount", "Plant", "StorageLocation", "ShippingPoint",
];

export const SIMULATION_METADATA = wrap("API_SALES_ORDER_SIMULATION_SRV",
  type("A_SalesOrderSimulationType", ["SalesOrder"], SIMULATION_HEADER_PROPS, ["to_Credit", "to_Item", "to_Partner", "to_Pricing", "to_PricingElement"]) +
  type("A_SalesOrderItemSimulationType", ["SalesOrder", "SalesOrderItem"], SIMULATION_ITEM_PROPS, ["to_Partner", "to_PricingElement", "to_SalesOrder", "to_ScheduleLine"]) +
  type("A_SalesOrderScheduleLineSimlnType", ["SalesOrder", "SalesOrderItem", "ScheduleLine"], SCHEDULE_LINE_PROPS) +
  type("A_SalesOrderCreditSimulationType", ["SalesOrder"], ["SalesOrder", "TotalCreditCheckStatus"]) +
  type("A_SalesOrderPricingSimulationType", ["SalesOrder"], ["SalesOrder", "TotalNetAmount", "TransactionCurrency"]) +
  sets("API_SALES_ORDER_SIMULATION_SRV", [["A_SalesOrderSimulation", "A_SalesOrderSimulationType"]]));

// [D] -- written from SAP's published documentation, not verified against a response or a generated client. Used so the delivery and
// billing readers can be exercised; a real system's own $metadata is what the code trusts.
export const OUTBOUND_DELIVERY_METADATA = wrap("API_OUTBOUND_DELIVERY_SRV",
  type("A_OutbDeliveryHeaderType", ["DeliveryDocument"], ["DeliveryDocument", "CreationDate", "DeliveryDate", "PlannedGoodsIssueDate", "ActualGoodsMovementDate", "OverallGoodsMovementStatus"]) +
  type("A_OutbDeliveryItemType", ["DeliveryDocument", "DeliveryDocumentItem"], ["DeliveryDocument", "DeliveryDocumentItem", "ReferenceSDDocument", "ReferenceSDDocumentItem"]) +
  sets("API_OUTBOUND_DELIVERY_SRV", [["A_OutbDeliveryHeader", "A_OutbDeliveryHeaderType"], ["A_OutbDeliveryItem", "A_OutbDeliveryItemType"]]));

export const BILLING_DOCUMENT_METADATA = wrap("API_BILLING_DOCUMENT_SRV",
  type("A_BillingDocumentType", ["BillingDocument"], ["BillingDocument", "CreationDate", "BillingDocumentDate", "TotalNetAmount", "TaxAmount", "TotalGrossAmount", "TransactionCurrency", "BillingDocumentIsCancelled", "InvoiceClearingStatus", "NetDueDate"]) +
  type("A_BillingDocumentItemType", ["BillingDocument", "BillingDocumentItem"], ["BillingDocument", "BillingDocumentItem", "SalesDocument", "ReferenceSDDocument"]) +
  sets("API_BILLING_DOCUMENT_SRV", [["A_BillingDocument", "A_BillingDocumentType"], ["A_BillingDocumentItem", "A_BillingDocumentItemType"]]));

export const ORDER_METADATA: Record<string, string> = {
  API_SALES_ORDER_SRV: SALES_ORDER_METADATA,
  API_SALES_ORDER_SIMULATION_SRV: SIMULATION_METADATA,
  API_OUTBOUND_DELIVERY_SRV: OUTBOUND_DELIVERY_METADATA,
  API_BILLING_DOCUMENT_SRV: BILLING_DOCUMENT_METADATA,
};
