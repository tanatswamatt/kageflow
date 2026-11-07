export type ImportType = "customers" | "contacts" | "products" | "vehicles" | "opening_balances";

export const IMPORTS: Record<ImportType, { label: string; help: string; columns: string[]; required: string[]; sample: string[] }> = {
  customers: {
    label: "Customers and suppliers",
    help: "One row per company or person you sell to or buy from.",
    columns: ["name", "kind", "email", "phone", "vat_no", "billing_address", "city", "country", "payment_days"],
    required: ["name"],
    sample: ["Nairobi Fleet Ltd", "customer", "accounts@nairobifleet.example", "+254700000000", "", "Mombasa Rd, Nairobi", "Nairobi", "KE", "30"],
  },
  contacts: {
    label: "Contacts",
    help: "People. account_name links them to a customer already in Kageflow (exact name).",
    columns: ["first_name", "last_name", "account_name", "job_title", "email", "phone", "consent_basis"],
    required: ["first_name"],
    sample: ["Wanjiru", "Kamau", "Nairobi Fleet Ltd", "Fleet manager", "w@nairobifleet.example", "+254700000001", "contract"],
  },
  products: {
    label: "Products and services",
    help: "tracking is stock (counted), none (services) or serial (by VIN). vat_code is STD, ZERO, EXEMPT or NONE. Receive opening stock on each product afterwards.",
    columns: ["sku", "name", "tracking", "sale_price", "currency", "vat_code"],
    required: ["sku", "name"],
    sample: ["TOWBAR-HILUX", "Tow bar kit Hilux", "stock", "2500", "ZAR", "STD"],
  },
  vehicles: {
    label: "Vehicles in stock",
    help: "One row per VIN. opening_cost (excl. VAT) is posted as the vehicle's landed cost, credited to the account you choose.",
    columns: ["vin", "make", "model", "variant", "year", "colour", "mileage_km", "location", "status", "list_price", "list_currency", "opening_cost"],
    required: ["vin"],
    sample: ["JTEBX3FJ70K123456", "Toyota", "Land Cruiser 79", "4.5 V8 D/C", "2022", "White", "48000", "Durban yard", "in_stock", "720000", "ZAR", "585000"],
  },
  opening_balances: {
    label: "Opening balances",
    help: "Your trial balance at go-live, by account code. Creates a draft journal for your accountant to check and post.",
    columns: ["account_code", "debit", "credit", "description"],
    required: ["account_code"],
    sample: ["1000", "250000", "", "Bank at go-live"],
  },
};

/** Other names the same column goes by in Sage, Pastel, Xero, VMG and spreadsheet exports */
export const ALIASES: Record<string, string[]> = {
  name: ["full name (from file)", "customer name", "account name", "customer", "client", "client name", "full name", "display name", "contact name", "name", "company", "company name", "organization 1 - name", "organisation"],
  kind: ["type", "account type", "category"],
  email: ["e-mail", "email address", "e-mail address", "mail", "e-mail 1 - value", "primary email", "email 1", "work email", "personal email"],
  phone: ["telephone", "tel", "telephone 1", "phone number", "cell", "cellphone", "cell no", "mobile", "mobile phone", "mobile phone number", "mobile number", "whatsapp", "whatsapp number", "phone 1 - value", "primary phone", "business phone", "home phone", "contact number", "contact no"],
  vat_no: ["vat number", "vat no", "vat reg no", "vat registration", "tax number", "tax reference", "tax no"],
  billing_address: ["address", "postal address", "physical address", "address 1", "address line 1", "street", "street address", "billing street", "mailing street", "address 1 - street", "business street"],
  city: ["town", "suburb", "city/town", "billing city", "mailing city", "address 1 - city", "business city"],
  country: ["country code", "billing country", "mailing country", "address 1 - country", "country/region"],
  payment_days: ["terms", "payment terms", "days"],
  first_name: ["first name", "firstname", "given name", "name"],
  last_name: ["last name", "surname", "lastname", "family name"],
  account_name: ["company", "company name", "customer", "account", "account name", "organization 1 - name", "organization", "organisation"],
  job_title: ["title", "job title", "position", "role", "organization 1 - title"],
  sku: ["code", "item code", "product code", "stock code"],
  sale_price: ["price", "selling price", "retail price", "price excl"],
  vin: ["vin", "vin number", "vin no", "chassis", "chassis number", "chassis no", "serial", "serial number"],
  make: ["manufacturer", "brand"],
  model: ["model name", "range"],
  variant: ["derivative", "description", "spec", "trim", "series"],
  year: ["model year", "reg year", "year model", "first registered"],
  colour: ["color", "colour name", "exterior colour"],
  mileage_km: ["mileage", "odometer", "km", "kms", "kilometres", "odo"],
  location: ["branch", "site", "yard", "lot"],
  list_price: ["selling price", "retail", "retail price", "price", "asking price", "advertised price"],
  opening_cost: ["cost", "cost price", "purchase price", "stand in", "stand-in", "stand in value", "trade price", "book value"],
  account_code: ["code", "account", "gl code", "account number"],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[_\s]+/g, " ").replace(/[^a-z0-9 /-]/g, "");

/** For each column Kageflow wants, the file column that most likely holds it (-1 if none) */
export function autoMap(headers: string[], columns: string[]): Record<string, number> {
  const h = headers.map(norm);
  const used = new Set<number>();
  const out: Record<string, number> = {};
  for (const c of columns) {
    const names = [norm(c), ...(ALIASES[c] ?? []).map(norm)];
    let idx = h.findIndex((x, i) => !used.has(i) && x === norm(c));
    if (idx < 0) idx = h.findIndex((x, i) => !used.has(i) && names.includes(x));
    if (idx < 0) idx = h.findIndex((x, i) => !used.has(i) && names.some((n) => n.length > 3 && x.includes(n)));
    out[c] = idx;
    if (idx >= 0) used.add(idx);
  }
  return out;
}

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === ";") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** Phone and Google/Outlook contact exports (.vcf) as rows, so they import like a CSV */
export function parseVcf(text: string): string[][] {
  const rows: string[][] = [["Full name (from file)", "First name", "Last name", "Email", "Phone", "Company", "Job title"]];
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  for (const card of unfolded.split(/BEGIN:VCARD/i).slice(1)) {
    const lines = card.split(/\r?\n/);
    const get = (key: string) => lines.filter((l) => new RegExp(`^(item\\d+\\.)?${key}[;:]`, "i").test(l)).map((l) => l.slice(l.indexOf(":") + 1).replace(/\\,/g, ",").replace(/\\;/g, ";").trim());
    const fn = get("FN")[0] ?? "";
    const [last = "", first = ""] = (get("N")[0] ?? "").split(";");
    const tels = get("TEL");
    const mobile = lines.find((l) => /^(item\d+\.)?TEL[^:]*(CELL|MOBILE)/i.test(l));
    const phone = mobile ? mobile.slice(mobile.indexOf(":") + 1).trim() : tels[0] ?? "";
    const org = (get("ORG")[0] ?? "").split(";")[0] ?? "";
    const name = fn || [first, last].filter(Boolean).join(" ") || org;
    if (!name && !phone) continue;
    rows.push([name, first, last, get("EMAIL")[0] ?? "", phone.replace(/^tel:/i, ""), org, get("TITLE")[0] ?? ""]);
  }
  return rows;
}

/** CRM exports split people's names: give the customers import one name column (person's name, else the company) */
export function addFullName(grid: string[][]): string[][] {
  const h = grid[0]!.map((x) => norm(x));
  if (h.includes(norm("Full name (from file)"))) return grid;
  const fi = h.findIndex((x) => ["first name", "firstname", "given name"].includes(x));
  const li = h.findIndex((x) => ["last name", "surname", "lastname", "family name"].includes(x));
  if (fi < 0 && li < 0) return grid;
  const ci = h.findIndex((x) => ["company", "company name", "organization 1 - name", "organisation", "organization", "account name"].includes(x));
  return grid.map((r, i) => i === 0 ? [...r, "Full name (from file)"]
    : [...r, [r[fi] ?? "", r[li] ?? ""].map((v) => (v ?? "").trim()).filter(Boolean).join(" ") || (ci >= 0 ? (r[ci] ?? "").trim() : "")]);
}
