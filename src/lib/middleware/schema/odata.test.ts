import { describe, expect, it } from "vitest";
import { listEntitySets, parseODataSchema } from "./odata";

const XML = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
 <edmx:DataServices>
  <Schema Namespace="Contoso" xmlns="http://docs.oasis-open.org/odata/ns/edm">
   <EnumType Name="SalesStatus"><Member Name="Open" Value="0"/><Member Name="Delivered" Value="1"/><Member Name="_x0020_hidden" Value="9"/></EnumType>
   <ComplexType Name="Address"><Property Name="City" Type="Edm.String"/><Property Name="Country" Type="Edm.String" Nullable="false"/></ComplexType>
   <EntityType Name="SalesOrder">
    <Key><PropertyRef Name="OrderId"/></Key>
    <Property Name="OrderId" Type="Edm.String" Nullable="false"/>
    <Property Name="CustomerAccount" Type="Edm.String" Nullable="false"/>
    <Property Name="Status" Type="Contoso.SalesStatus"/>
    <Property Name="Total" Type="Edm.Decimal"/>
    <Property Name="Quantity" Type="Edm.Int32"/>
    <Property Name="DeliveryDate" Type="Edm.Date"/>
    <Property Name="CreatedAt" Type="Edm.DateTimeOffset"/>
    <Property Name="Urgent" Type="Edm.Boolean"/>
    <Property Name="ShipTo" Type="Contoso.Address"/>
    <Property Name="Tags" Type="Collection(Edm.String)"/>
    <NavigationProperty Name="Audit" Type="Collection(Contoso.AuditEntry)"/>
    <NavigationProperty Name="Items" Type="Collection(Contoso.SalesOrderItem)"/>
    <NavigationProperty Name="Customer" Type="Contoso.Customer"/>
   </EntityType>
   <EntityType Name="SalesOrderItem">
    <Key><PropertyRef Name="LineNo"/></Key>
    <Property Name="LineNo" Type="Edm.Int32" Nullable="false"/>
    <Property Name="Material" Type="Edm.String"/>
    <Property Name="Unit" Type="Edm.String" sap:label="Order unit" sap:creatable="false" xmlns:sap="http://www.sap.com/Protocols/SAPData"/>
   </EntityType>
   <EntityType Name="AuditEntry"><Property Name="Note" Type="Edm.String"/></EntityType>
   <EntityType Name="Customer"><Property Name="Name" Type="Edm.String"/></EntityType>
   <EntityContainer Name="Container">
    <EntitySet Name="SalesOrders" EntityType="Contoso.SalesOrder"/>
    <EntitySet Name="Customers" EntityType="Contoso.Customer"/>
   </EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>`;

describe("parseODataSchema", () => {
  it("reads one entity set: types, enum members, required by Nullable=false and key, complex types flattened", () => {
    const r = parseODataSchema(XML, { entitySet: "SalesOrders" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const by = Object.fromEntries(r.fields.map((f) => [f.path, f]));
    expect(by.OrderId).toMatchObject({ type: "text", required: true });
    expect(by.CustomerAccount.required).toBe(true);
    expect(by.Status).toMatchObject({ type: "enum", enum: ["Open", "Delivered"] });
    expect(by.Total.type).toBe("number");
    expect(by.Quantity.type).toBe("integer");
    expect(by.DeliveryDate.type).toBe("date");
    expect(by.CreatedAt.type).toBe("datetime");
    expect(by.Urgent.type).toBe("boolean");
    expect(by["ShipTo.City"]).toMatchObject({ type: "text", required: false });
    expect(by["ShipTo.Country"].required).toBe(false);
    expect(by.Tags.type).toBe("array");
  });

  it("offers the collection navigation as the lines block (preferring item-like names), with SAP label and creatable", () => {
    const r = parseODataSchema(XML, { entitySet: "SalesOrders" });
    if (!r.ok) throw new Error(r.message);
    expect(r.linesPath).toBe("Items");
    expect(r.lineFields.map((f) => f.path).sort()).toEqual(["LineNo", "Material", "Unit"]);
    expect(r.lineFields.find((f) => f.path === "Unit")).toMatchObject({ label: "Order unit", creatable: false });
    expect(r.lineFields.find((f) => f.path === "LineNo")?.required).toBe(true);
    expect(r.notes.join(" ")).toMatch(/Audit/);
  });

  it("without an entity set it lists them to pick from; an unknown one does too", () => {
    const r = parseODataSchema(XML);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.operations?.map((o) => o.path)).toEqual(["/Customers", "/SalesOrders"]);
    expect(listEntitySets(XML)).toHaveLength(2);
    const unk = parseODataSchema(XML, { entitySet: "Nope" });
    expect(!unk.ok && unk.operations?.length).toBe(2);
    expect(parseODataSchema(XML, { entitySet: "/salesorders" }).ok).toBe(true);
  });

  it("refuses anything that is not a $metadata document", () => {
    for (const bad of ["", "<html><body>login</body></html>", "{}", "plain"]) expect(parseODataSchema(bad, { entitySet: "x" })).toMatchObject({ ok: false });
  });

  it("does not choke on a very large document or hostile markup", () => {
    const many = Array.from({ length: 3000 }, (_, i) => `<EntityType Name="E${i}"><Property Name="P" Type="Edm.String"/></EntityType>`).join("");
    const big = `<Edmx><Schema>${many}<EntityContainer><EntitySet Name="Es" EntityType="X.E7"/></EntityContainer></Schema></Edmx>`;
    const t0 = Date.now();
    expect(parseODataSchema(big, { entitySet: "Es" })).toMatchObject({ ok: true });
    expect(Date.now() - t0).toBeLessThan(3000);
    const hostile = `<!DOCTYPE x [<!ENTITY a "aaaa">]><Edmx><Schema><EntityType Name="__proto__"><Property Name="constructor" Type="Edm.String"/><Property Name="ok" Type="Edm.String"/></EntityType><EntityContainer><EntitySet Name="S" EntityType="N.__proto__"/></EntityContainer></Schema></Edmx>`;
    const r = parseODataSchema(hostile, { entitySet: "S" });
    expect(r.ok && r.fields.map((f) => f.path)).toEqual(["ok"]);
  });
});
