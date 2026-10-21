import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Empty, Input, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { memberNames } from "@/lib/members";
import { label, money } from "@/lib/format";
import { kindTone } from "@/lib/badges";
import type { CrmAccount } from "@/lib/types";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string; error?: string; ok?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const q = params.q?.trim();
  let query = ctx.supabase.from("crm_accounts").select("*").eq("company_id", ctx.companyId).order("name").limit(300);
  if (q) query = query.ilike("name", `%${q}%`);

  const [{ data }, { data: deals }, names] = await Promise.all([
    query,
    ctx.supabase.from("crm_deals").select("account_id, value, currency").eq("company_id", ctx.companyId).eq("status", "open"),
    memberNames(),
  ]);
  const accounts = (data ?? []) as CrmAccount[];
  const base = ctx.company.base_currency;
  const openByAccount = new Map<string, { count: number; value: number }>();
  for (const d of (deals ?? []) as { account_id: string; value: number; currency: string }[]) {
    const cur = openByAccount.get(d.account_id) ?? { count: 0, value: 0 };
    cur.count += 1;
    if (d.currency === base) cur.value += Number(d.value);
    openByAccount.set(d.account_id, cur);
  }

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Companies and people you sell to, buy from or partner with."
        actions={ctx.can("crm.write") && <ButtonLink href="/crm/accounts/new" tone="primary">New account</ButtonLink>}
      />
      <Notice params={params} />
      <form className="mb-4 w-full sm:w-72">
        <Input name="q" type="search" defaultValue={q} placeholder="Search accounts" aria-label="Search accounts" />
      </form>
      <Panel flush>
        {accounts.length === 0 ? (
          <Empty title={q ? "No accounts match that search" : "No accounts yet"}>Converting a lead creates one automatically.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Location</Th>
                <Th>Contact</Th>
                <Th className="text-right">Open deals</Th>
                <Th>Owner</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const open = openByAccount.get(a.id);
                return (
                  <tr key={a.id} className="hover:bg-paper">
                    <Td><Link href={`/crm/accounts/${a.id}`} className="font-medium hover:underline">{a.name}</Link></Td>
                    <Td><Badge tone={kindTone[a.kind]}>{label(a.kind)}</Badge></Td>
                    <Td className="text-ink-soft">{[a.city, a.country].filter(Boolean).join(", ")}</Td>
                    <Td className="text-ink-soft">{a.email || a.phone}</Td>
                    <Td className="num">{open ? `${open.count} · ${money(open.value, base)}` : ""}</Td>
                    <Td className="text-ink-soft">{a.owner_id ? names.get(a.owner_id) : "Unassigned"}</Td>
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
