#!/usr/bin/env node
// Live check of an SAP S/4HANA system for the BPMSquare connector. Not run by the tests.
//
//   Communication user:   SAP_API_HOST=my426318-api.s4hana.cloud.sap SAP_USER=... SAP_PASSWORD=... node scripts/sap-s4-smoke.mjs
//   Sandbox (API key):    SAP_API_KEY=... node scripts/sap-s4-smoke.mjs        (host sandbox.api.sap.com is implied)
//
// The password and the API key are read from the environment only and are never printed. Read-only: GET requests.
// It makes the same calls as the Test button (business partners, products, $metadata) and prints counts.

const host = (process.env.SAP_API_HOST ?? "").trim().replace(/^https:\/\//i, "").replace(/\/+$/, "");
const user = process.env.SAP_USER ?? "";
const password = process.env.SAP_PASSWORD ?? "";
const apiKey = process.env.SAP_API_KEY ?? "";

const sandbox = !!apiKey && !password;
const origin = `https://${sandbox ? "sandbox.api.sap.com" : host}`;
const prefix = sandbox ? "/s4hanacloud" : "";

if (!sandbox && (!host || !user || !password)) {
  console.error("Set SAP_API_HOST, SAP_USER and SAP_PASSWORD (or SAP_API_KEY for the sandbox).");
  process.exit(2);
}

const headers = sandbox
  ? { APIKey: apiKey, Accept: "application/json" }
  : { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, Accept: "application/json" };

const SCENARIO = { API_BUSINESS_PARTNER: "SAP_COM_0008 (Business Partner, Customer and Supplier Integration)", API_PRODUCT_SRV: "SAP_COM_0009 (Product Integration)" };
const WHY = {
  401: "wrong user or password, or the user is in no arrangement for this scenario",
  403: "the user is not assigned to the Communication Arrangement of this scenario",
  404: "the scenario is not active: add a Communication Arrangement for it",
};

async function get(service, path, accept = "application/json") {
  const url = `${origin}${prefix}/sap/opu/odata/sap/${service}/${path}`;
  const res = await fetch(url, { headers: { ...headers, Accept: accept }, redirect: "error", signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  if (!res.ok) {
    const hint = WHY[res.status] ? ` (${WHY[res.status]}; scenario ${SCENARIO[service]})` : "";
    throw new Error(`${service}/${path.split("?")[0]} answered ${res.status}${hint}`);
  }
  return text;
}

const count = async (service, set, filter) => {
  const q = filter ? `?$filter=${encodeURIComponent(filter)}` : "";
  const n = Number((await get(service, `${set}/$count${q}`, "text/plain")).trim());
  return Number.isFinite(n) ? n : null;
};

const line = (label, value) => console.log(`${label.padEnd(34)} ${value}`);

let failed = false;
const step = async (label, fn) => {
  try {
    line(label, await fn());
  } catch (e) {
    failed = true;
    line(label, `FAILED: ${e.message}`);
  }
};

console.log(sandbox ? "SAP Business Accelerator Hub sandbox (sample data)" : `SAP S/4HANA ${host}`);
await step("Business partners (first row)", async () => {
  const j = JSON.parse(await get("API_BUSINESS_PARTNER", "A_BusinessPartner?$top=1&$format=json"));
  return `ok (${(j.d?.results ?? []).length} row)`;
});
await step("$metadata (business partner)", async () => `ok (${(await get("API_BUSINESS_PARTNER", "$metadata", "application/xml")).length} characters)`);
await step("Business partners total", async () => await count("API_BUSINESS_PARTNER", "A_BusinessPartner"));
await step("  with a customer number", async () => await count("API_BUSINESS_PARTNER", "A_BusinessPartner", "Customer ne ''"));
await step("  with a supplier number", async () => await count("API_BUSINESS_PARTNER", "A_BusinessPartner", "Supplier ne ''"));
await step("Products (first row)", async () => {
  const j = JSON.parse(await get("API_PRODUCT_SRV", "A_Product?$top=1&$format=json&$expand=to_Description"));
  return `ok (${(j.d?.results ?? []).length} row)`;
});
await step("Products total", async () => await count("API_PRODUCT_SRV", "A_Product", "IsMarkedForDeletion eq false"));

process.exit(failed ? 1 : 0);
