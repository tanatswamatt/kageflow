/**
 * Country rules. A dealership picks its country once, at sign-up, and it can't be changed afterwards
 * (the database refuses), because tax, invoices and privacy law all follow from it.
 */
export type CountryCode = "ZA" | "ZW";

export type CountryRules = {
  code: CountryCode;
  name: string;
  /** Standard VAT rate as a fraction, e.g. 0.15 */
  vatRate: number;
  vatRateLabel: string;
  taxAuthority: string;
  /** Menu and page title for the VAT return */
  vatReturnName: string;
  /** Where the figures go */
  vatReturnWhere: string;
  /** Base currencies a dealership in this country may keep its books in; the first is the default */
  baseCurrencies: string[];
  dialCode: string;
  phonePlaceholder: string;
  /** Data protection law, full and short names */
  privacyLaw: string;
  privacyLawShort: string;
  registrationLabel: string;
  registrationPlaceholder: string;
  tradingPlaceholder: string;
  legalPlaceholder: string;
  vatNoHint: string;
  idLabel: string;
  idHint: string;
  /** Second-hand goods bought from non-vendors carry notional input tax */
  notionalInputTax: boolean;
  /** Tax invoices must come from a fiscal device linked to the tax authority */
  fiscalInvoices: boolean;
  /** Above this amount (base currency, incl. VAT) a tax invoice needs the buyer's address. null: no such rule */
  fullInvoiceThreshold: number | null;
  /** First month of the tax year, 1-12 */
  taxYearStart: number;
  /** Payroll liabilities account name */
  payrollAccount: string;
  validId: (id: string) => boolean;
};

/** South African ID: 13 digits, valid date of birth, Luhn check digit */
function validSaId(id: string) {
  if (!/^\d{13}$/.test(id)) return false;
  const mm = Number(id.slice(2, 4)), dd = Number(id.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id[i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Zimbabwe national ID: district code, 6 or 7 digits, check letter, district of origin. e.g. 63-1234567 F 42 */
function validZwId(id: string) {
  return /^\d{2}-?\d{6,7}\s?-?[A-Z]\s?-?\d{2}$/i.test(id.trim());
}

export const COUNTRIES: Record<CountryCode, CountryRules> = {
  ZA: {
    code: "ZA",
    name: "South Africa",
    vatRate: 0.15,
    vatRateLabel: "15%",
    taxAuthority: "SARS",
    vatReturnName: "VAT201",
    vatReturnWhere: "Copy these figures into SARS eFiling.",
    baseCurrencies: ["ZAR"],
    dialCode: "27",
    phonePlaceholder: "+27 82 000 0000",
    privacyLaw: "Protection of Personal Information Act (POPIA)",
    privacyLawShort: "POPIA",
    registrationLabel: "CIPC registration number",
    registrationPlaceholder: "2024/123456/07",
    tradingPlaceholder: "Mzansi Motors",
    legalPlaceholder: "Mzansi Motors (Pty) Ltd",
    vatNoHint: "Leave blank if not VAT registered",
    idLabel: "SA ID number",
    idHint: "13 digits",
    notionalInputTax: true,
    fiscalInvoices: false,
    fullInvoiceThreshold: 5000,
    taxYearStart: 3,
    payrollAccount: "PAYE, UIF and SDL payable",
    validId: validSaId,
  },
  ZW: {
    code: "ZW",
    name: "Zimbabwe",
    vatRate: 0.155,
    vatRateLabel: "15.5%",
    taxAuthority: "ZIMRA",
    vatReturnName: "VAT return",
    vatReturnWhere: "Use these figures for your VAT return to ZIMRA.",
    baseCurrencies: ["USD", "ZWG"],
    dialCode: "263",
    phonePlaceholder: "+263 77 000 0000",
    privacyLaw: "Cyber and Data Protection Act",
    privacyLawShort: "Data protection",
    registrationLabel: "Company registration number",
    registrationPlaceholder: "1234/2024",
    tradingPlaceholder: "Harare Motor Mart",
    legalPlaceholder: "Harare Motor Mart (Private) Limited",
    vatNoHint: "Leave blank if not VAT registered with ZIMRA",
    idLabel: "National ID number",
    idHint: "For example 63-1234567 F 42",
    notionalInputTax: false,
    fiscalInvoices: true,
    fullInvoiceThreshold: null,
    taxYearStart: 1,
    payrollAccount: "PAYE, AIDS levy and NSSA payable",
    validId: validZwId,
  },
};

export const COUNTRY_CODES = Object.keys(COUNTRIES) as CountryCode[];

export function countryRules(code: string | null | undefined): CountryRules {
  return COUNTRIES[(code as CountryCode) in COUNTRIES ? (code as CountryCode) : "ZA"];
}

/** Local phone number to the digits WhatsApp wants (country code, no plus) */
export function waDigits(phone: string | null | undefined, rules: CountryRules) {
  const d = (phone ?? "").replace(/\D/g, "");
  if (/^0\d{8,10}$/.test(d)) return rules.dialCode + d.slice(1);
  return d;
}

/** The VAT part of a VAT-inclusive amount at the country's standard rate */
export const vatFraction = (amount: number, rules: CountryRules) => Math.round(((amount * rules.vatRate) / (1 + rules.vatRate)) * 100) / 100;
