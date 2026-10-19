import type { ObjectSpec } from "./types";

// BOM components as their own Data Workbench object (child family, like Quote
// Lines): import adds components to BOM / kit products that already exist,
// export lists every line with both products' ids and SKUs, update bulk-edits
// qty / unit / scrap / kind / note by the LINE's own Record ID only.
//
// Fixed shape, never tenant-customizable, so a static spec. NOT exposed on the
// v1 API or MCP on purpose: BOM structure and cost are internal.
export const PRODUCT_BOM_LINES_SPEC: ObjectSpec = {
  id: "product_bom_lines",
  label: "BOM components",
  icon: "⊞",
  description: "Components of BOM / kit products — add components to a kit that already exists, or bulk-edit quantity, unit, scrap and kind on lines already there. Only BOM / kit items can have components.",
  dependsOn: ["products"],
  fields: [
    { key: "parent", label: "BOM / kit", type: "ref", required: true, hint: "SKU or product ID of the BOM / kit product — must already exist and be of type BOM / kit", aliases: ["bom", "kit", "parent", "parent sku", "parent item", "bom sku", "assembly"] },
    { key: "component", label: "Component", type: "ref", required: true, hint: "SKU or product ID of the component product — must already exist", aliases: ["component sku", "child", "child sku", "item", "material", "part"] },
    { key: "qty", label: "Qty", type: "number", required: true, hint: "Quantity of the component per one kit, above zero", aliases: ["quantity", "qty per"] },
    { key: "uom", label: "Unit", type: "text", hint: "Unit of the quantity — defaults to the component's unit", aliases: ["uom", "unit of measure"] },
    { key: "scrap_pct", label: "Scrap %", type: "number", hint: "Extra consumed to allow for waste, 0 to 100", aliases: ["scrap", "waste", "waste %"] },
    { key: "line_kind", label: "Kind", type: "enum", options: ["consumed", "used"], hint: "consumed adds to the material cost; used (a tool) does not — defaults to consumed", aliases: ["type", "line kind"] },
    { key: "note", label: "Note", type: "text", hint: "Optional note on the line", aliases: ["notes", "remark", "remarks"] },
    // Export-only: the ids and names an Update or an integration keys off.
    { key: "parent_product_id", label: "BOM / kit product ID (record)", type: "text", exportOnly: true, hint: "The kit's internal record id" },
    { key: "component_product_id", label: "Component product ID (record)", type: "text", exportOnly: true, hint: "The component's internal record id" },
    { key: "parent_sku", label: "BOM / kit SKU", type: "text", exportOnly: true, hint: "SKU of the kit" },
    { key: "component_sku", label: "Component SKU", type: "text", exportOnly: true, hint: "SKU of the component" },
    { key: "parent_name", label: "BOM / kit name", type: "text", exportOnly: true, hint: "Name of the kit" },
    { key: "component_name", label: "Component name", type: "text", exportOnly: true, hint: "Name of the component" },
  ],
  sampleRows: [
    { parent: "(SKU of a BOM / kit)", component: "(SKU of a component)", qty: "2", uom: "Nos", scrap_pct: "5", line_kind: "consumed" },
    { parent: "(SKU of a BOM / kit)", component: "(SKU of a tool)", qty: "1", uom: "Nos", scrap_pct: "0", line_kind: "used", note: "Not consumed" },
  ],
};
