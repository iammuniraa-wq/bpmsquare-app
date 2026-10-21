import { describe, it, expect } from "vitest";
import { parseDataverseAttributes, parseODataMetadata, fieldsFromSampleRow, missingRequired, suggestMapping, isMetadataEntity } from "./metadata";

const dv = {
  value: [
    { LogicalName: "name", DisplayName: { UserLocalizedLabel: { Label: "Quote Name" } }, AttributeType: "String", RequiredLevel: { Value: "ApplicationRequired" }, IsValidForCreate: true, AttributeOf: null },
    { LogicalName: "customerid", DisplayName: { UserLocalizedLabel: { Label: "Potential Customer" } }, AttributeType: "Customer", RequiredLevel: { Value: "ApplicationRequired" }, IsValidForCreate: true, AttributeOf: null },
    { LogicalName: "pricelevelid", DisplayName: { UserLocalizedLabel: { Label: "Price List" } }, AttributeType: "Lookup", RequiredLevel: { Value: "SystemRequired" }, IsValidForCreate: true, AttributeOf: null },
    { LogicalName: "quoteid", DisplayName: { UserLocalizedLabel: { Label: "Quote" } }, AttributeType: "Uniqueidentifier", RequiredLevel: { Value: "SystemRequired" }, IsValidForCreate: false, AttributeOf: null },
    { LogicalName: "description", DisplayName: { UserLocalizedLabel: { Label: "Description" } }, AttributeType: "Memo", RequiredLevel: { Value: "None" }, IsValidForCreate: true, AttributeOf: null },
    { LogicalName: "totalamount_base", DisplayName: null, AttributeType: "Money", RequiredLevel: { Value: "None" }, IsValidForCreate: false, AttributeOf: "totalamount" },
    { LogicalName: "freightamount", DisplayName: null, AttributeType: "Money", RequiredLevel: { Value: "None" }, IsValidForCreate: true, AttributeOf: null },
  ],
};

describe("Dataverse attribute metadata", () => {
  const fields = parseDataverseAttributes(dv);

  it("reads logical name, display name, type, required and creatable", () => {
    const name = fields.find((f) => f.name === "name")!;
    expect(name).toEqual({ name: "name", label: "Quote Name", type: "String", required: true, creatable: true });
    expect(fields.find((f) => f.name === "quoteid")).toMatchObject({ required: true, creatable: false });
    expect(fields.find((f) => f.name === "freightamount")!.label).toBe("Freightamount");
  });

  it("drops shadow columns and lists required fields first", () => {
    expect(fields.map((f) => f.name)).not.toContain("totalamount_base");
    expect(fields.slice(0, 4).every((f) => f.required)).toBe(true);
    expect(fields.at(-1)!.required).toBe(false);
  });

  it("tolerates nothing at all", () => {
    expect(parseDataverseAttributes(null)).toEqual([]);
    expect(parseDataverseAttributes({})).toEqual([]);
  });
});

const edmx = `<?xml version="1.0"?><edmx:Edmx><edmx:DataServices><Schema Namespace="Microsoft.Dynamics.DataEntities">
<EntityType Name="Project"><Key><PropertyRef Name="dataAreaId"/><PropertyRef Name="ProjectID"/></Key>
<Property Name="dataAreaId" Type="Edm.String" Nullable="false"/>
<Property Name="ProjectID" Type="Edm.String" Nullable="false"/>
<Property Name="ProjectName" Type="Edm.String"/>
<Property Name="CustomerAccount" Type="Edm.String"/>
<Property Name="StartDate" Type="Edm.DateTimeOffset" Nullable="true"/>
</EntityType>
<EntityType Name="Other"><Property Name="X" Type="Edm.String"/></EntityType>
<EntityContainer Name="Default"><EntitySet Name="Projects" EntityType="Microsoft.Dynamics.DataEntities.Project"/><EntitySet Name="Others" EntityType="Microsoft.Dynamics.DataEntities.Other"/></EntityContainer>
</Schema></edmx:DataServices></edmx:Edmx>`;

describe("OData $metadata (Finance and Operations, Business Central)", () => {
  it("finds the entity type behind the entity set and reads its properties", () => {
    const f = parseODataMetadata(edmx, "Projects");
    expect(f.map((x) => x.name).sort()).toEqual(["CustomerAccount", "ProjectID", "ProjectName", "StartDate", "dataAreaId"]);
    expect(f.find((x) => x.name === "ProjectID")).toMatchObject({ type: "String", required: true });
    expect(f.find((x) => x.name === "StartDate")).toMatchObject({ type: "DateTimeOffset", required: false });
    expect(f.find((x) => x.name === "ProjectName")!.label).toBe("Project Name");
  });

  it("is empty for an unknown set or broken XML", () => {
    expect(parseODataMetadata(edmx, "Nope")).toEqual([]);
    expect(parseODataMetadata("<not-xml", "Projects")).toEqual([]);
  });

  it("falls back to the keys of a sample row when $metadata is not usable", () => {
    const f = fieldsFromSampleRow({ id: "1", displayName: "x", amount: 3, active: true, "@odata.etag": "w", note: null });
    expect(f.map((x) => `${x.name}:${x.type}`).sort()).toEqual(["active:Boolean", "amount:Number", "displayName:String", "id:String", "note:Unknown"]);
    expect(fieldsFromSampleRow(null)).toEqual([]);
  });
});

describe("required fields not mapped", () => {
  const fields = parseDataverseAttributes(dv);

  it("flags required, creatable fields no map entry fills", () => {
    expect(missingRequired(fields, ["description"]).map((f) => f.name).sort()).toEqual(["customerid", "name", "pricelevelid"]);
  });

  it("a navigation bind fills its lookup, and the fields the engine always sets are never reported", () => {
    expect(missingRequired(fields, ["name", "customerid_account@odata.bind", "pricelevelid@odata.bind"])).toEqual([]);
    expect(missingRequired(fields, [], ["name", "customerid", "pricelevelid"])).toEqual([]);
  });

  it("never reports a field that cannot be set on create", () => {
    expect(missingRequired(fields, []).some((f) => f.name === "quoteid")).toBe(false);
  });
});

describe("suggest mapping by name", () => {
  const erp = [
    { name: "name", label: "Account Name", type: "String", required: true, creatable: true },
    { name: "telephone1", label: "Main Phone", type: "String", required: false, creatable: true },
    { name: "emailaddress1", label: "Email", type: "String", required: false, creatable: true },
    { name: "address1_city", label: "Address 1: City", type: "String", required: false, creatable: true },
    { name: "createdon", label: "Created On", type: "DateTime", required: false, creatable: false },
    { name: "productnumber", label: "Product ID", type: "String", required: true, creatable: true },
  ];

  it("matches by same name, same label and known pairs, each ERP field once", () => {
    const s = suggestMapping([{ key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "city", label: "City" }, { key: "sku", label: "SKU" }], erp);
    const by = Object.fromEntries(s.map((x) => [x.bpm, x]));
    expect(by.name).toMatchObject({ erp: "name", reason: "same name" });
    expect(by.email).toMatchObject({ erp: "emailaddress1", reason: "same label" });
    expect(by.phone.erp).toBe("telephone1");
    expect(by.city.erp).toBe("address1_city");
    expect(by.sku.erp).toBe("productnumber");
    expect(new Set(s.map((x) => x.erp)).size).toBe(s.length);
  });

  it("proposes nothing it cannot back and never a field that cannot be created", () => {
    expect(suggestMapping([{ key: "zzz", label: "Unrelated" }], erp)).toEqual([]);
    expect(suggestMapping([{ key: "createdon", label: "Created on" }], erp)).toEqual([]);
  });

  it("knows the entities it serves", () => {
    expect(isMetadataEntity("quote_line")).toBe(true);
    expect(isMetadataEntity("invoices")).toBe(false);
  });
});
