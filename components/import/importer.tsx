"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";
import { IMPORTS, autoMap, parseCsv, type ImportType } from "@/lib/import-spec";
import type { ImportResult, RowMatch } from "@/app/(app)/settings/import/actions";

type Action = "create" | "update" | "skip";
const sel = "h-9 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-sm";
const MATCHABLE: ImportType[] = ["customers", "vehicles"];

export function Importer({
  action, check, creditAccounts, canLedger,
}: {
  action: (fd: FormData) => Promise<ImportResult>;
  check: (type: ImportType, rows: Record<string, string>[]) => Promise<{ matches?: RowMatch[]; error?: string }>;
  creditAccounts: { id: string; label: string; key: string | null }[];
  canLedger: boolean;
}) {
  const [type, setType] = useState<ImportType>("customers");
  const [headers, setHeaders] = useState<string[]>([]);
  const [grid, setGrid] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [matches, setMatches] = useState<RowMatch[] | null>(null);
  const [choice, setChoice] = useState<Action[]>([]);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  const spec = IMPORTS[type];

  const template = useMemo(() => {
    const csv = `${spec.columns.join(",")}\n${spec.sample.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")}\n`;
    return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  }, [spec]);

  const reset = () => { setHeaders([]); setGrid([]); setMap({}); setMatches(null); setChoice([]); setProblem(null); };

  const onFile = async (file: File | undefined) => {
    reset();
    setResult(null);
    if (!file) return;
    if (file.size > 2_000_000) return setProblem("That file is over 2 MB. Split it into smaller files.");
    const g = parseCsv(await file.text());
    if (g.length < 2) return setProblem("The file needs a header row and at least one data row.");
    if (g.length - 1 > 2000) return setProblem("Import up to 2 000 rows at a time.");
    const h = g[0]!.map((x) => x.trim());
    setHeaders(h);
    setGrid(g.slice(1));
    setMap(autoMap(h, spec.columns));
  };

  // rows keyed by Kageflow's column names, using the chosen mapping
  const rows = useMemo(
    () => grid.map((r) => Object.fromEntries(spec.columns.filter((c) => (map[c] ?? -1) >= 0).map((c) => [c, (r[map[c]!] ?? "").trim()]))),
    [grid, map, spec],
  );
  const missing = spec.required.filter((c) => (map[c] ?? -1) < 0);
  const cols = spec.columns.filter((c) => (map[c] ?? -1) >= 0);
  const needsCredit = type === "vehicles" && rows.some((r) => r.opening_cost);
  const canMatch = MATCHABLE.includes(type);
  const ready = rows.length > 0 && missing.length === 0 && (!canMatch || matches !== null);

  const runCheck = () => {
    setProblem(null);
    start(async () => {
      const r = await check(type, rows);
      if (r.error || !r.matches) { setProblem(r.error ?? "Couldn't check for matches"); return; }
      setMatches(r.matches);
      setChoice(r.matches.map((m) => (m.id ? "update" : m.dupOf !== null ? "skip" : "create")));
    });
  };

  // the result shows right here, next to the button, instead of at the top of the page
  const submit = async (fd: FormData) => {
    setResult(null);
    const r = await action(fd);
    if (r.ok) reset();
    setResult(r);
  };

  const payload = rows.map((r, i) => (matches ? { ...r, _action: choice[i] ?? "create", _match: matches[i]?.id ?? "" } : r));
  const counts = { create: 0, update: 0, skip: 0 };
  if (matches) for (const c of choice) counts[c]++;
  const found = matches?.filter((m) => m.id).length ?? 0;
  const dups = matches?.filter((m) => m.dupOf !== null).length ?? 0;
  const setAll = (from: "matched" | "dups", to: Action) => setChoice((cs) => cs.map((c, i) => ((from === "matched" ? matches?.[i]?.id : matches?.[i]?.dupOf !== null) ? to : c)));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">What are you importing?</span>
          <select value={type} onChange={(e) => { setType(e.target.value as ImportType); reset(); }} className={sel}>
            {(Object.keys(IMPORTS) as ImportType[]).filter((k) => canLedger || k !== "opening_balances").map((k) => <option key={k} value={k}>{IMPORTS[k].label}</option>)}
          </select>
        </label>
        <a href={template} download={`kageflow-${type}-template.csv`} className={buttonClass("secondary", "sm")}>Download template</a>
      </div>
      <p className="text-ink-soft">{spec.help} Exports from Sage, Pastel, VMG or Excel work as they are: Kageflow matches the columns for you and you can correct it below.</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-soft">CSV file (comma or semicolon separated, saved from Excel as CSV UTF-8)</span>
        <input key={type} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm file:mr-3 file:rounded-[var(--radius-control)] file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm" />
      </label>
      {problem && <p role="alert" className="text-ember-700">{problem}</p>}

      {headers.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-[15px] font-semibold">1. Match the columns</h3>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {spec.columns.map((c) => (
              <label key={c} className="flex items-center justify-between gap-2 text-[13px]">
                <span className={spec.required.includes(c) ? "font-medium" : "text-ink-soft"}>{c.replace(/_/g, " ")}{spec.required.includes(c) ? " *" : ""}</span>
                <select value={map[c] ?? -1} onChange={(e) => { setMap((m) => ({ ...m, [c]: Number(e.target.value) })); setMatches(null); }} className={`${sel} w-44`}>
                  <option value={-1}>Not in file</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {missing.length > 0 && <p className="text-ember-700">Choose the file column for: {missing.join(", ")}.</p>}
          {headers.filter((_, i) => !Object.values(map).includes(i)).length > 0 && (
            <p className="text-xs text-ink-faint">Not imported: {headers.filter((_, i) => !Object.values(map).includes(i)).join(", ")}</p>
          )}
        </section>
      )}

      {rows.length > 0 && missing.length === 0 && canMatch && (
        <section className="flex flex-col gap-3">
          <h3 className="text-[15px] font-semibold">2. Check what&apos;s already in Kageflow</h3>
          {!matches && (
            <div>
              <button type="button" onClick={runCheck} disabled={pending} className={buttonClass("secondary")}>{pending ? "Checking…" : `Check ${rows.length} rows for matches`}</button>
              <p className="mt-1 text-xs text-ink-faint">{type === "customers" ? "Matched on VAT number, email, phone (any format), then name." : "Matched on VIN."} Nothing is saved yet.</p>
            </div>
          )}
          {matches && (
            <>
              <p className="text-ink-soft">
                {found} already in Kageflow{dups ? `, ${dups} repeated in the file` : ""}, {rows.length - found - dups} new.
                {found > 0 && type === "customers" && " Updating only fills blanks; nothing already saved is overwritten."}
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                {found > 0 && <><button type="button" className={buttonClass("secondary", "sm")} onClick={() => setAll("matched", "update")}>Update all matches</button><button type="button" className={buttonClass("secondary", "sm")} onClick={() => setAll("matched", "skip")}>Skip all matches</button></>}
                {dups > 0 && <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setAll("dups", "create")}>Import repeats anyway</button>}
              </div>
            </>
          )}
        </section>
      )}

      {rows.length > 0 && missing.length === 0 && (
        <form action={submit} className="flex flex-col gap-4">
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="rows" value={JSON.stringify(payload)} />
          <div className="max-h-[28rem] overflow-auto rounded-[var(--radius-control)] border border-line">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-paper"><tr>
                {matches && <th className="px-3 py-2 text-left font-medium text-ink-faint">Action</th>}
                {matches && <th className="px-3 py-2 text-left font-medium text-ink-faint">Match</th>}
                {cols.map((c) => <th key={c} className="px-3 py-2 text-left font-medium text-ink-faint">{c}</th>)}
              </tr></thead>
              <tbody>
                {rows.slice(0, matches ? 300 : 8).map((r, i) => {
                  const m = matches?.[i];
                  return (
                    <tr key={i} className={`border-t border-line ${choice[i] === "skip" ? "text-ink-faint" : ""}`}>
                      {matches && (
                        <td className="px-2 py-1">
                          <select value={choice[i]} onChange={(e) => setChoice((cs) => cs.map((c, j) => (j === i ? (e.target.value as Action) : c)))} className="h-7 rounded border border-line-strong bg-surface px-1 text-xs">
                            <option value="create">Add new</option>
                            {m?.id && <option value="update">Update existing</option>}
                            <option value="skip">Skip</option>
                          </select>
                        </td>
                      )}
                      {matches && (
                        <td className="px-3 py-1.5 whitespace-nowrap text-xs">
                          {m?.id ? <Link target="_blank" href={type === "customers" ? `/crm/accounts/${m.id}` : `/inventory/units/${m.id}`} className="text-shadow-700 hover:underline">{m.name}</Link> : null}
                          {m?.id && <span className="ml-1 text-ink-faint">by {m.on}</span>}
                          {m?.dupOf !== null && m?.dupOf !== undefined && <span className="text-amber-700">Same as row {m.dupOf + 2}</span>}
                          {!m?.id && m?.dupOf === null && <span className="text-jade-700">New</span>}
                        </td>
                      )}
                      {cols.map((c) => <td key={c} className="px-3 py-1.5 whitespace-nowrap">{r[c]}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-ink-soft">
            {rows.length} rows{rows.length > (matches ? 300 : 8) ? `; the first ${matches ? 300 : 8} are shown` : ""}.
            {matches && ` ${counts.create} to add, ${counts.update} to update, ${counts.skip} to skip.`}
          </p>
          {type === "opening_balances" && (
            <label className="flex max-w-xs flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">Go-live date</span>
              <input type="date" name="as_of" required className={sel} />
            </label>
          )}
          {needsCredit && (
            <label className="flex max-w-sm flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">Credit opening vehicle costs to</span>
              <select name="credit_account_id" defaultValue={creditAccounts.find((a) => a.key === "suspense")?.id} className={sel}>
                {creditAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <span className="text-xs text-ink-faint">Use Suspense if your opening balances journal already includes inventory, then clear it there. Opening costs are only posted for new vehicles.</span>
            </label>
          )}
          {ready && <div><ImportButton count={matches ? counts.create + counts.update : rows.length} /></div>}
          {!ready && canMatch && matches === null && <p className="text-[13px] text-amber-700">Check the rows for matches first; the Import button appears after that.</p>}
          {type === "customers" && <p className="text-xs text-ink-faint">Already have doubles from before? <Link href="/crm/duplicates" className="text-shadow-700 hover:underline">Find and merge duplicate customers</Link>.</p>}
        </form>
      )}

      {result && (
        <div className={`rounded-[var(--radius-control)] px-4 py-3 text-[14px] ${result.ok ? "bg-jade-50 text-jade-700" : "bg-ember-50 text-ember-700"}`} role="status">
          {result.ok ?? result.error}
          {result.ok && type === "vehicles" && <> <Link href="/inventory/units" className="font-medium underline">See your vehicles</Link></>}
          {result.ok && type === "customers" && <> <Link href="/crm/accounts" className="font-medium underline">See your customers</Link></>}
        </div>
      )}
    </div>
  );
}

function ImportButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending || count === 0} className={buttonClass("primary")}>{pending ? "Importing…" : `Import ${count} rows`}</button>;
}
