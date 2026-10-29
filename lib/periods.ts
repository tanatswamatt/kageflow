const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthStart = (y: number, m: number) => new Date(y, m, 1);
const monthEnd = (y: number, m: number) => new Date(y, m + 1, 0);

export const validDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Tax year starting in startMonth (1-12): March in South Africa, January in Zimbabwe */
export function taxYear(offset = 0, startMonth = 3, now = new Date()) {
  const m0 = startMonth - 1;
  const y = (now.getMonth() >= m0 ? now.getFullYear() : now.getFullYear() - 1) + offset;
  return m0 === 0
    ? { from: iso(monthStart(y, 0)), to: iso(monthEnd(y, 11)) }
    : { from: iso(monthStart(y, m0)), to: iso(monthEnd(y + 1, m0 - 1)) };
}

export function month(offset = 0, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return { from: iso(monthStart(d.getFullYear(), d.getMonth())), to: iso(monthEnd(d.getFullYear(), d.getMonth())) };
}

/** Two-month VAT periods. endsEven: Category B (Jan-Feb, Mar-Apr ...); otherwise Category A (Dec-Jan, Feb-Mar ...) */
export function vatPeriods(endsEven: boolean, count = 6, now = new Date()) {
  const out: { from: string; to: string }[] = [];
  let y = now.getFullYear();
  let m = now.getMonth(); // 0-based; end month must be odd index for "even" calendar months (Feb=1)
  const isEnd = (mm: number) => (endsEven ? (mm + 1) % 2 === 0 : (mm + 1) % 2 === 1);
  while (!isEnd(m)) { m += 1; if (m > 11) { m = 0; y += 1; } }
  for (let i = 0; i < count; i++) {
    const end = monthEnd(y, m);
    const start = monthStart(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1);
    out.push({ from: iso(start), to: iso(end) });
    m -= 2;
    if (m < 0) { m += 12; y -= 1; }
  }
  return out;
}

export function periodLabel(from: string, to: string) {
  const f = new Date(`${from}T00:00:00`), t = new Date(`${to}T00:00:00`);
  const fmt = (d: Date, withYear: boolean) => d.toLocaleDateString("en-ZA", { month: "short", ...(withYear ? { year: "numeric" } : {}) });
  return f.getFullYear() === t.getFullYear() ? `${fmt(f, false)} to ${fmt(t, true)}` : `${fmt(f, true)} to ${fmt(t, true)}`;
}
