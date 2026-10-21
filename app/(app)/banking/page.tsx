import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Empty, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { fail } from "@/lib/forms";
import { date, money, today } from "@/lib/format";
import { loadBankAccounts } from "@/lib/purchases-data";

export const metadata: Metadata = { title: "Bank" };

export default async function BankingPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("banking.write")) fail("/dashboard", "Only owners, admins and accountants can see bank reconciliation");
  const [banks, { data: tb }, { data: lines }] = await Promise.all([
    loadBankAccounts(ctx),
    ctx.supabase.rpc("trial_balance", { p_company: ctx.companyId, p_as_of: today() }),
    ctx.supabase.from("bank_statement_lines").select("bank_account_id, status, txn_date").eq("company_id", ctx.companyId).limit(20000),
  ]);
  const bal = new Map(((tb ?? []) as { account_id: string; balance: number }[]).map((r) => [r.account_id, Number(r.balance)]));
  const stats = new Map<string, { unmatched: number; last: string | null }>();
  for (const l of (lines ?? []) as { bank_account_id: string; status: string; txn_date: string }[]) {
    const s = stats.get(l.bank_account_id) ?? { unmatched: 0, last: null };
    if (l.status === "unmatched") s.unmatched += 1;
    if (!s.last || l.txn_date > s.last) s.last = l.txn_date;
    stats.set(l.bank_account_id, s);
  }

  return (
    <>
      <PageHeader title="Bank" description="Import your bank statements and tick them off against Kageflow, so the books match the bank." />
      <Notice params={sp} />
      <Panel flush>
        {banks.length === 0 ? <Empty title="No bank accounts">Add one under Accounting, Chart of accounts.</Empty> : (
          <Table>
            <thead><tr><Th>Account</Th><Th className="text-right">Balance in Kageflow</Th><Th>Statement up to</Th><Th>To reconcile</Th></tr></thead>
            <tbody>
              {banks.map((b) => {
                const s = stats.get(b.id);
                return (
                  <tr key={b.id} className="hover:bg-paper">
                    <Td><Link href={`/banking/${b.id}`} className="font-medium hover:underline">{b.code} {b.name}</Link></Td>
                    <Td className="num">{money(bal.get(b.id) ?? 0, ctx.company.base_currency)}</Td>
                    <Td className="text-ink-soft">{s?.last ? date(s.last) : "No statement yet"}</Td>
                    <Td>{s?.unmatched ? <Badge tone="amber">{s.unmatched} lines</Badge> : s ? <Badge tone="jade">All matched</Badge> : ""}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
