// The explanations the Products screen keeps behind an "i" (bpmsquarecore 6b). One place so a test holds every text
// to the InfoTip limit (two sentences, 160 characters).

export const PRODUCT_TIPS = {
  page: "The category tree products are filed under, and the kinds of item they can be.",
  categories: "Two levels: category and sub-category. While the tree is empty, the product form falls back to free text.",
  code: "Records store the code and screens show the name, so you can rename any time. Match it to your ERP's key where one is connected.",
  itemTypes: "Each product can have one item type. Only BOM / kit items can have components, and that stays true for any type you add.",
  hide: "A hidden type is not offered on new products and stays on the ones that have it. A type that products still carry can be hidden but not removed.",
  flags: "Stocked, sold and bought describe how items of this type are used. They are informational today.",
} as const;
