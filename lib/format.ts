const numberFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** R 20,000.00 for rand; USD 20,000.00 for other currencies (a bare $ is ambiguous on export documents) */
export function money(value: number | string | null | undefined, currency = "ZAR"): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  const v = Number.isFinite(n) ? n : 0;
  const body = numberFormat.format(Math.abs(v));
  const sign = v < 0 ? "-" : "";
  return currency === "ZAR" ? `${sign}R ${body}` : `${sign}${currency} ${body}`;
}

/** Plain amount for ledger columns; blank for zero */
export function amount(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!n) return "";
  return numberFormat.format(n);
}

export function date(value: string | null | undefined): string {
  if (!value) return "";
  const d = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function personName(p: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  if (!p) return "";
  return [p.first_name, p.last_name].filter(Boolean).join(" ");
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function label(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
