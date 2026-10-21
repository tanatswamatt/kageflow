import type { Metadata } from "next";
import Link from "next/link";
import { Button, Empty, Input, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { amount, date, money, today } from "@/lib/format";
import { TYPE_LABEL, TYPE_ORDER } from "@/lib/ledger";
import type { AccountType } from "@/lib/types";

export const metadata: Metadata = { title: "Trial balance" };

type Row = { account_id: string; code: string; name: string; type: AccountType; debit: number; credit: number; balance: number };

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ as_of?: string; zero?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const asOf = params.as_of && /^\d{4}-\d{2}-\d{2}$/.test(params.as_of) ? params.as_of : today();
  const showZero = params.zero === "1";
  const { data, error } = await ctx.supabase.rpc("trial_balance", { p_company: ctx.companyId, p_as_of: asOf });
  const rows = ((data ?? []) as Row[]).map((r) => ({ ...r, balance: Number(r.balance) })).filter((r) => showZero || r.balance !== 0);
  const dr = rows.reduce((s, r) => s + (r.balance > 0 ? r.balance : 0), 0);
  const cr = rows.reduce((s, r) => s + (r.balance < 0 ? -r.balance : 0), 0);
  const balanced = Math.round(dr * 100) === Math.round(cr * 100);
  const base = ctx.company.base_currency;

  return (
    <>
      <PageHeader
        title="Trial balance"
        description={`Closing balances of posted journals up to ${date(asOf)}. Click an account to see the entries behind it.`}
        actions={
          <form className="flex items-center gap-2">
            <Input name="as_of" type="date" defaultValue={asOf} aria-label="As of date" className="w-40" />
            <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
              <input type="checkbox" name="zero" value="1" defaultChecked={showZero} className="accent-jade-700" /> Zero balances
            </label>
            <Button type="submit" size="sm">Update</Button>
          </form>
        }
      />
      {error && <p className="mb-4 text-ember-700">{error.message}</p>}
      <Panel flush>
        {rows.length === 0 ? (
          <Empty title="Nothing posted yet">Post a journal and its balances show here.</Empty>
        ) : (
          <Table>
            <thead>
              <tr><Th>Code</Th><Th>Account</Th><Th className="text-right">Debit ({base})</Th><Th className="text-right">Credit ({base})</Th></tr>
            </thead>
            {TYPE_ORDER.map((type) => {
              const group = rows.filter((r) => r.type === type);
              if (!group.length) return null;
              return (
                <tbody key={type}>
                  <tr><td colSpan={4} className="bg-paper px-4 py-2 text-[13px] font-semibold text-ink-soft">{TYPE_LABEL[type]}</td></tr>
                  {group.map((r) => (
                    <tr key={r.account_id} className="hover:bg-paper">
                      <Td className="w-20 tabular-nums">{r.code}</Td>
                      <Td><Link href={`/accounting/accounts/${r.account_id}`} className="hover:underline">{r.name}</Link></Td>
                      <Td className="num">{r.balance > 0 ? amount(r.balance) : ""}</Td>
                      <Td className="num">{r.balance < 0 ? amount(-r.balance) : ""}</Td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={2} className="px-4 py-3 text-right">Totals</td>
                <td className="num border-t-2 border-ink px-4 py-3">{money(dr, base)}</td>
                <td className="num border-t-2 border-ink px-4 py-3">{money(cr, base)}</td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Panel>
      {rows.length > 0 && (
        <p className={`mt-3 text-sm font-medium ${balanced ? "text-jade-700" : "text-ember-700"}`}>
          {balanced ? "Debits equal credits." : `Out of balance by ${money(Math.abs(dr - cr), base)}. Contact support: the database should prevent this.`}
        </p>
      )}
    </>
  );
}
