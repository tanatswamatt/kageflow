"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";

type AccountOption = { id: string; code: string; name: string };
type Line = { key: number; account_id: string; description: string; debit: string; credit: string };

const cents = (v: string) => {
  const n = Number(v.replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const fmt = (c: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(c / 100);

let nextKey = 3;
const blank = (key: number): Line => ({ key, account_id: "", description: "", debit: "", credit: "" });

export function JournalForm({ accounts, today, currency, action }: { accounts: AccountOption[]; today: string; currency: string; action: (fd: FormData) => Promise<void> }) {
  const [lines, setLines] = useState<Line[]>([blank(1), blank(2)]);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + cents(l.debit), 0);
    const credit = lines.reduce((s, l) => s + cents(l.credit), 0);
    return { debit, credit, diff: debit - credit };
  }, [lines]);
  const balanced = totals.debit > 0 && totals.diff === 0;

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const payload = JSON.stringify(lines.map(({ account_id, description, debit, credit }) => ({ account_id, description, debit, credit })));

  const cell = "h-9 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-2.5 text-sm focus:border-shadow-700 focus:outline-none focus:ring-2 focus:ring-shadow-100";

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="lines" value={payload} />
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">Date</span>
          <input name="journal_date" type="date" defaultValue={today} required className={cell} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">Description</span>
          <input name="description" required placeholder="Owner's capital contribution" className={cell} />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-faint">
              <th className="w-8 pb-2 font-medium">#</th>
              <th className="pb-2 font-medium">Account</th>
              <th className="pb-2 font-medium">Line description</th>
              <th className="w-36 pb-2 text-right font-medium">Debit ({currency})</th>
              <th className="w-36 pb-2 text-right font-medium">Credit ({currency})</th>
              <th className="w-10 pb-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key}>
                <td className="py-1 pr-2 text-ink-faint tabular-nums">{i + 1}</td>
                <td className="py-1 pr-2">
                  <select aria-label={`Line ${i + 1} account`} value={l.account_id} onChange={(e) => update(l.key, { account_id: e.target.value })} className={cell}>
                    <option value="">Choose account</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <input aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} className={cell} />
                </td>
                <td className="py-1 pr-2">
                  <input aria-label={`Line ${i + 1} debit`} inputMode="decimal" value={l.debit} onChange={(e) => update(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} className={`${cell} text-right tabular-nums`} />
                </td>
                <td className="py-1 pr-2">
                  <input aria-label={`Line ${i + 1} credit`} inputMode="decimal" value={l.credit} onChange={(e) => update(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} className={`${cell} text-right tabular-nums`} />
                </td>
                <td className="py-1 text-right">
                  {lines.length > 2 && (
                    <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded px-2 py-1 text-ink-faint hover:bg-ember-50 hover:text-ember-700" aria-label={`Remove line ${i + 1}`}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3">
                <button type="button" onClick={() => setLines((ls) => [...ls, blank(nextKey++)])} className="text-[13px] font-medium text-shadow-700 hover:underline">
                  Add line
                </button>
              </td>
              <td className="border-t border-line-strong pt-3 pr-2 text-right font-semibold tabular-nums">{fmt(totals.debit)}</td>
              <td className="border-t border-line-strong pt-3 pr-2 text-right font-semibold tabular-nums">{fmt(totals.credit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
        <p role="status" className={`text-sm font-medium ${balanced ? "text-jade-700" : totals.debit || totals.credit ? "text-ember-700" : "text-ink-faint"}`}>
          {balanced ? "Balanced" : totals.debit || totals.credit ? `Out of balance by ${fmt(Math.abs(totals.diff))}` : "Enter at least two lines"}
        </p>
        <Actions balanced={balanced} />
      </div>
    </form>
  );
}

function Actions({ balanced }: { balanced: boolean }) {
  const { pending, data } = useFormStatus();
  const intent = data?.get("intent");
  return (
    <div className="flex gap-2">
      <button type="submit" name="intent" value="draft" disabled={pending} className={buttonClass("secondary")}>
        {pending && intent === "draft" ? "Saving…" : "Save draft"}
      </button>
      <button type="submit" name="intent" value="post" disabled={pending || !balanced} className={buttonClass("primary")}>
        {pending && intent === "post" ? "Posting…" : "Save and post"}
      </button>
    </div>
  );
}
