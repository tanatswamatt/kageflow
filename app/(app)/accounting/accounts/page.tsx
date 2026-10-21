import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { naturalBalance, TYPE_LABEL, TYPE_ORDER } from "@/lib/ledger";
import type { AccountType, LedgerAccount } from "@/lib/types";
import { createLedgerAccount } from "../actions";

export const metadata: Metadata = { title: "Chart of accounts" };

type TbRow = { account_id: string; balance: number };

export default async function ChartPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const [{ data }, { data: tb }] = await Promise.all([
    ctx.supabase.from("accounts").select("*").eq("company_id", ctx.companyId).order("code"),
    ctx.supabase.rpc("trial_balance", { p_company: ctx.companyId }),
  ]);
  const accounts = (data ?? []) as LedgerAccount[];
  const balances = new Map(((tb ?? []) as TbRow[]).map((r) => [r.account_id, Number(r.balance)]));
  const base = ctx.company.base_currency;

  return (
    <>
      <PageHeader title="Chart of accounts" description="Balances include posted journals only. System accounts are used by the posting engine and keep their type." />
      <Notice params={params} />
      <div className={`grid gap-6 ${ctx.can("ledger.write") ? "lg:grid-cols-[1fr_300px]" : ""}`}>
        <Panel flush className="min-w-0">
          <Table>
            <thead>
              <tr><Th>Code</Th><Th>Name</Th><Th /><Th className="text-right">Balance ({base})</Th></tr>
            </thead>
            {TYPE_ORDER.map((type) => {
              const group = accounts.filter((a) => a.type === type);
              if (group.length === 0) return null;
              return (
                <tbody key={type}>
                  <tr><td colSpan={4} className="bg-paper px-4 py-2 text-[13px] font-semibold text-ink-soft">{TYPE_LABEL[type]}</td></tr>
                  {group.map((a) => (
                    <tr key={a.id} className={`hover:bg-paper ${a.is_active ? "" : "text-ink-faint"}`}>
                      <Td className="w-20 tabular-nums">{a.code}</Td>
                      <Td><Link href={`/accounting/accounts/${a.id}`} className="hover:underline">{a.name}</Link></Td>
                      <Td className="text-right">
                        {a.is_system && <Badge tone="shadow">System</Badge>} {!a.is_active && <Badge>Inactive</Badge>}
                      </Td>
                      <Td className="num">{balances.get(a.id) ? money(naturalBalance(a.type, balances.get(a.id)!), base) : ""}</Td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </Table>
        </Panel>
        {ctx.can("ledger.write") && (
          <Panel title="Add account" className="self-start">
            <form action={createLedgerAccount} className="flex flex-col gap-3">
              <Field label="Code"><Input name="code" required pattern="[0-9A-Za-z.\-]{1,20}" placeholder="6450" /></Field>
              <Field label="Name"><Input name="name" required placeholder="Security services" /></Field>
              <Field label="Type">
                <Select name="type" defaultValue="expense">
                  {TYPE_ORDER.map((t: AccountType) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </Select>
              </Field>
              <Field label="Description"><Input name="description" /></Field>
              <div><SubmitButton size="sm">Add account</SubmitButton></div>
            </form>
          </Panel>
        )}
      </div>
    </>
  );
}
