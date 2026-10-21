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
