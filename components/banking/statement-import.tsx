"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";

type Row = { date: string; description: string; amount: number; balance: number | null };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const delim = (text.split("\n")[0] ?? "").split(";").length > (text.split("\n")[0] ?? "").split(",").length ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row.map((c) => c.trim()));
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row.map((c) => c.trim()));
  return rows;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
const pad = (s: string) => s.padStart(2, "0");
function parseDate(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return `${m[3]!.length === 2 ? "20" + m[3] : m[3]}-${pad(m[2]!)}-${pad(m[1]!)}`;
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})/);
  if (m && MONTHS[m[2]!.toLowerCase()]) return `${m[3]!.length === 2 ? "20" + m[3] : m[3]}-${MONTHS[m[2]!.toLowerCase()]}-${pad(m[1]!)}`;
  return null;
}
function parseAmount(v: string | undefined): number | null {
  if (v === undefined) return null;
  let s = v.trim().replace(/^R\s?/i, "").replace(/\s/g, "");
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/-$/.test(s)) { sign = -1; s = s.slice(0, -1); }
  if (/dr$/i.test(s)) { sign = -1; s = s.slice(0, -2); }
  if (/cr$/i.test(s)) s = s.slice(0, -2);
  if (/,\d{2}$/.test(s) && !/\.\d/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : null;
}

const find = (headers: string[], words: RegExp) => headers.findIndex((h) => words.test(h.toLowerCase()));

export function StatementImport({ bankId, action }: { bankId: string; action: (fd: FormData) => Promise<void> }) {
  const [grid, setGrid] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState({ date: -1, description: -1, amount: -1, moneyIn: -1, moneyOut: -1, balance: -1 });
  const [name, setName] = useState("");

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setName(f.name);
    const g = parseCsv(await f.text());
    // skip preamble lines banks put above the table
    const start = Math.max(0, g.findIndex((r) => r.some((c) => /date/i.test(c))));
    const table = g.slice(start);
    const headers = (table[0] ?? []).map((h) => h.toLowerCase());
    const header = headers.some((h) => /date|amount|description|balance/.test(h));
    setHasHeader(header);
    setGrid(table);
    const h = header ? headers : [];
    const amountIdx = find(h, /^amount|amount$|bedrag/);
    setMap({
      date: header ? find(h, /date|datum/) : 0,
      description: header ? find(h, /desc|narrative|details|reference|transaction$/) : 1,
      amount: header ? amountIdx : 2,
      moneyIn: header && amountIdx < 0 ? find(h, /credit|money in|deposit|in$/) : -1,
      moneyOut: header && amountIdx < 0 ? find(h, /debit|money out|withdraw|out$/) : -1,
      balance: header ? find(h, /balance|saldo/) : -1,
    });
  };

  const headers = hasHeader ? (grid[0] ?? []) : (grid[0] ?? []).map((_, i) => `Column ${i + 1}`);
  const body = hasHeader ? grid.slice(1) : grid;
  const rows: Row[] = useMemo(() => body.flatMap((r) => {
    const date = map.date >= 0 ? parseDate(r[map.date] ?? "") : null;
    let amt: number | null = null;
    if (map.amount >= 0) amt = parseAmount(r[map.amount]);
    else if (map.moneyIn >= 0 || map.moneyOut >= 0) {
      const i = map.moneyIn >= 0 ? parseAmount(r[map.moneyIn]) ?? 0 : 0;
      const o = map.moneyOut >= 0 ? parseAmount(r[map.moneyOut]) ?? 0 : 0;
      amt = Math.round((Math.abs(i) - Math.abs(o)) * 100) / 100;
    }
    if (!date || amt === null || amt === 0) return [];
    const description = map.description >= 0 ? (r[map.description] ?? "") : "";
    return [{ date, description, amount: amt, balance: map.balance >= 0 ? parseAmount(r[map.balance]) : null }];
  }), [body, map]);

  const sel = (key: keyof typeof map, label: string) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
      {label}
      <select value={map[key]} onChange={(e) => setMap((m) => ({ ...m, [key]: Number(e.target.value) }))} className="h-9 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-sm font-normal text-ink">
        <option value={-1}>Not in file</option>
        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
      </select>
    </label>
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="bank_id" value={bankId} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-soft">Download a CSV statement from your bank's online banking, then choose it here.</span>
        <input type="file" accept=".csv,text/csv,.txt" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
      </label>
      {grid.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {sel("date", "Date")}
            {sel("description", "Description")}
            {sel("amount", "Amount (+ in, - out)")}
            {sel("moneyIn", "Or: money in")}
            {sel("moneyOut", "Or: money out")}
            {sel("balance", "Balance (optional)")}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink-soft"><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} className="accent-jade-700" /> First row is column names</label>
          <div className="overflow-x-auto rounded-[var(--radius-control)] border border-line">
            <table className="w-full text-sm">
              <thead><tr className="bg-paper text-left text-xs text-ink-faint"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
              <tbody>
                {rows.slice(0, 6).map((r, i) => (
                  <tr key={i} className="border-t border-line"><td className="px-3 py-1.5 whitespace-nowrap">{r.date}</td><td className="px-3 py-1.5">{r.description}</td><td className={`px-3 py-1.5 text-right tabular-nums ${r.amount < 0 ? "text-ember-700" : "text-jade-700"}`}>{r.amount.toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-ink-soft">{rows.length} transactions read from {name}{body.length - rows.length > 0 ? `; ${body.length - rows.length} rows skipped (no date or amount)` : ""}. Money out should show as negative.</p>
          <Submit disabled={rows.length === 0} count={rows.length} />
        </>
      )}
    </form>
  );
}

function Submit({ disabled, count }: { disabled: boolean; count: number }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={disabled || pending} className={`${buttonClass("primary")} self-start`}>{pending ? "Importing…" : `Import ${count} transactions`}</button>;
}
