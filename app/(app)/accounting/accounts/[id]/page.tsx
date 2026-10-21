import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Empty, Field, Input, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { amount, date, money } from "@/lib/format";
import { naturalBalance, TYPE_LABEL } from "@/lib/ledger";
import type { LedgerAccount } from "@/lib/types";
import { updateLedgerAccount } from "../../actions";

export const metadata: Metadata = { title: "Account ledger" };

type Row = {
  id: string;
  description: string | null;
  debit: number;
  credit: number;
  journals: { id: string; number: string | null; journal_date: string; description: string; status: string };
};

/** General ledger for one account: every posted line, with a running balance */
export default async function AccountLedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const notice = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("accounts").select("*").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const account = data as LedgerAccount;

  const { data: lineData } = await ctx.supabase
    .from("journal_lines")
    .select("id, description, debit, credit, journals!inner(id, number, journal_date, description, status)")
    .eq("company_id", ctx.companyId)
    .eq("account_id", id)
    .eq("journals.status", "posted")
    .limit(2000);
  const lines = ((lineData ?? []) as unknown as Row[]).sort((a, b) =>
    a.journals.journal_date === b.journals.journal_date ? (a.journals.number ?? "").localeCompare(b.journals.number ?? "") : a.journals.journal_date.localeCompare(b.journals.journal_date),
  );
  const base = ctx.company.base_currency;
  let running = 0;

  return (
    <>
      <PageHeader
        title={`${account.code} ${account.name}`}
        description={`${TYPE_LABEL[account.type]}${account.is_system ? ", used by the posting engine" : ""}`}
        back={{ href: "/accounting/accounts", label: "Chart of accounts" }}
        actions={!account.is_active && <Badge>Inactive</Badge>}
      />
      <Notice params={notice} />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Panel flush className="min-w-0 self-start">
          {lines.length === 0 ? (
            <Empty title="No posted entries on this account" />
          ) : (
            <Table>
              <thead>
                <tr><Th>Date</Th><Th>Journal</Th><Th>Description</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th><Th className="text-right">Balance</Th></tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  running += Number(l.debit) - Number(l.credit);
                  return (
                    <tr key={l.id} className="hover:bg-paper">
                      <Td className="whitespace-nowrap">{date(l.journals.journal_date)}</Td>
                      <Td className="whitespace-nowrap tabular-nums"><Link href={`/accounting/journals/${l.journals.id}`} className="hover:underline">{l.journals.number}</Link></Td>
                      <Td className="text-ink-soft">{l.description || l.journals.description}</Td>
                      <Td className="num">{amount(l.debit)}</Td>
                      <Td className="num">{amount(l.credit)}</Td>
                      <Td className="num font-medium">{money(naturalBalance(account.type, running), base)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Panel>
        {ctx.can("ledger.write") && (
          <Panel title="Edit account" className="self-start">
            <form action={updateLedgerAccount} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={account.id} />
              <Field label="Name"><Input name="name" defaultValue={account.name} required /></Field>
              <Field label="Description"><Input name="description" defaultValue={account.description ?? ""} /></Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={account.is_active} className="size-4 accent-jade-700" />
                Active (inactive accounts can&apos;t receive new postings)
              </label>
              <div><SubmitButton size="sm">Save</SubmitButton></div>
            </form>
          </Panel>
        )}
      </div>
    </>
  );
}
