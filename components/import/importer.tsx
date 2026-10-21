"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";
import { IMPORTS, parseCsv, type ImportType } from "@/lib/import-spec";

export function Importer({ action, creditAccounts, canLedger }: { action: (fd: FormData) => Promise<void>; creditAccounts: { id: string; label: string; key: string | null }[]; canLedger: boolean }) {
  const [type, setType] = useState<ImportType>("customers");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const spec = IMPORTS[type];

  const template = useMemo(() => {
    const csv = `${spec.columns.join(",")}\n${spec.sample.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")}\n`;
    return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  }, [spec]);

  const onFile = async (file: File | undefined) => {
    setProblem(null);
    setRows([]);
    if (!file) return;
    if (file.size > 2_000_000) return setProblem("That file is over 2 MB. Split it into smaller files.");
    const grid = parseCsv(await file.text());
    if (grid.length < 2) return setProblem("The file needs a header row and at least one data row.");
    const header = grid[0]!.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const missing = spec.required.filter((r) => !header.includes(r));
    if (missing.length) return setProblem(`Missing column: ${missing.join(", ")}. Download the template to see the layout.`);
    const unknown = header.filter((h) => h && !spec.columns.includes(h));
    const parsed = grid.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
    if (parsed.length > 2000) return setProblem("Import up to 2 000 rows at a time.");
    setRows(parsed);
    if (unknown.length) setProblem(`These columns will be ignored: ${unknown.join(", ")}`);
  };

  const cols = spec.columns.filter((c) => rows.some((r) => r[c]));
  const needsCredit = type === "vehicles" && rows.some((r) => r.opening_cost);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">What are you importing?</span>
          <select value={type} onChange={(e) => { setType(e.target.value as ImportType); setRows([]); setProblem(null); }} className="h-9 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm">
            {(Object.keys(IMPORTS) as ImportType[]).filter((k) => canLedger || (k !== "opening_balances")).map((k) => <option key={k} value={k}>{IMPORTS[k].label}</option>)}
          </select>
        </label>
        <a href={template} download={`kageflow-${type}-template.csv`} className={buttonClass("secondary", "sm")}>Download template</a>
      </div>
      <p className="text-ink-soft">{spec.help} Columns: <span className="font-mono text-[12px]">{spec.columns.join(", ")}</span></p>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-soft">CSV file (comma or semicolon separated, saved from Excel as CSV UTF-8)</span>
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm file:mr-3 file:rounded-[var(--radius-control)] file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm" />
      </label>
      {problem && <p role="alert" className={rows.length ? "text-amber-700" : "text-ember-700"}>{problem}</p>}

      {rows.length > 0 && (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="rows" value={JSON.stringify(rows)} />
          <div className="overflow-x-auto rounded-[var(--radius-control)] border border-line">
            <table className="w-full text-[13px]">
              <thead className="bg-paper"><tr>{cols.map((c) => <th key={c} className="px-3 py-2 text-left font-medium text-ink-faint">{c}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => <tr key={i} className="border-t border-line">{cols.map((c) => <td key={c} className="px-3 py-1.5 whitespace-nowrap">{r[c]}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          <p className="text-ink-soft">{rows.length} rows ready{rows.length > 8 ? "; the first 8 are shown" : ""}.</p>
          {type === "opening_balances" && (
            <label className="flex max-w-xs flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">Go-live date</span>
              <input type="date" name="as_of" required className="h-9 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm" />
            </label>
          )}
          {needsCredit && (
            <label className="flex max-w-sm flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">Credit opening vehicle costs to</span>
              <select name="credit_account_id" defaultValue={creditAccounts.find((a) => a.key === "suspense")?.id} className="h-9 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm">
                {creditAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <span className="text-xs text-ink-faint">Use Suspense if your opening balances journal already includes inventory, then clear it there.</span>
            </label>
          )}
          <div><ImportButton count={rows.length} /></div>
        </form>
      )}
    </div>
  );
}

function ImportButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={buttonClass("primary")}>{pending ? "Importing…" : `Import ${count} rows`}</button>;
}
