import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Empty, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { date, moneyFor } from "@/lib/format";
import { amountToFinance, FINANCE_LABEL, FINANCE_TONE, type FinanceApplication, type FinanceSubmission } from "@/lib/finance";

export const metadata: Metadata = { title: "Finance applications" };

type Row = FinanceApplication & { crm_accounts: { name: string } | null; finance_submissions: Pick<FinanceSubmission, "bank" | "status">[] };
const VIEWS = [["open", "In progress"], ["approved", "Approved"], ["paid_out", "Paid out"], ["all", "All"]] as const;

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ v?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const v = VIEWS.some(([k]) => k === sp.v) ? sp.v! : "open";
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);
  if (!ctx.can("sales.write")) return <Panel><p className="text-ink-soft">Finance applications hold ID numbers and income, so viewers can&apos;t see them.</p></Panel>;
  let q = ctx.supabase.from("finance_applications").select("*, crm_accounts(name), finance_submissions(bank, status)").eq("company_id", ctx.companyId).order("updated_at", { ascending: false }).limit(300);
  if (v === "open") q = q.in("status", ["draft", "submitted", "approved", "contracted"]);
  if (v === "approved") q = q.in("status", ["approved", "contracted"]);
  if (v === "paid_out") q = q.eq("status", "paid_out");
  const { data } = await q;
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader title="Finance applications" description="One application per buyer, sent to as many banks as you like. Track every answer and the payout in one place."
        actions={<ButtonLink href="/sales/finance/new" tone="primary">New application</ButtonLink>} />
      <Notice params={sp} />
      <nav className="mb-4 flex flex-wrap gap-1">
        {VIEWS.map(([k, l]) => <Link key={k} href={`/sales/finance?v=${k}`} className={`rounded-full px-3 py-1 text-[13px] ${v === k ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>{l}</Link>)}
      </nav>
      <Panel flush>
        {rows.length === 0 ? <Empty title="No applications here">Start one from an order, or with New application.</Empty> : (
          <Table>
            <thead><tr><Th>Number</Th><Th>Buyer</Th><Th>Banks</Th><Th className="text-right">To finance</Th><Th>Status</Th><Th>Updated</Th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-paper">
                  <Td><Link href={`/sales/finance/${a.id}`} className="font-medium tabular-nums hover:underline">{a.number}</Link></Td>
                  <Td>{[a.first_name, a.last_name].filter(Boolean).join(" ") || a.crm_accounts?.name}</Td>
                  <Td className="text-[13px]">{a.finance_submissions.length === 0 ? <span className="text-ink-faint">Not sent yet</span> : a.finance_submissions.map((s) => (
                    <span key={s.bank} className="mr-2 whitespace-nowrap">{s.bank} <Badge tone={FINANCE_TONE[s.status]}>{FINANCE_LABEL[s.status]}</Badge></span>
                  ))}</Td>
                  <Td className="num">{money(amountToFinance(a))}</Td>
                  <Td><Badge tone={FINANCE_TONE[a.status]}>{FINANCE_LABEL[a.status]}</Badge></Td>
                  <Td className="whitespace-nowrap text-ink-soft">{date(a.updated_at.slice(0, 10))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
