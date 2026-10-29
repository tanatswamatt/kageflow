import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Empty, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { date, moneyFor } from "@/lib/format";
import type { TradeIn } from "@/lib/finance";

export const metadata: Metadata = { title: "Trade-ins" };

type Row = TradeIn & { crm_accounts: { name: string } | null };

export default async function TradeInsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);
  const { data } = await ctx.supabase.from("trade_ins").select("*, crm_accounts(name)").eq("company_id", ctx.companyId).order("created_at", { ascending: false }).limit(300);
  const rows = (data ?? []) as Row[];
  const owed = rows.filter((t) => t.status === "accepted").reduce((s, t) => s + Number(t.settlement_amount), 0);
  return (
    <>
      <PageHeader title="Trade-ins" description="Cars taken in as part of a deal. Accepting one puts it in stock and credits the customer."
        actions={ctx.can("sales.write") && <ButtonLink href="/sales/trade-ins/new" tone="primary">New trade-in</ButtonLink>} />
      <Notice params={sp} />
      {owed > 0 && <p className="mb-4 text-sm text-ink-soft">Settlements to pay to customers&apos; banks: <strong className="text-ink">{money(owed)}</strong>. Pay them from Bank, posting to account 2350.</p>}
      <Panel flush>
        {rows.length === 0 ? <Empty title="No trade-ins yet" /> : (
          <Table>
            <thead><tr><Th>Number</Th><Th>Customer</Th><Th>Vehicle</Th><Th className="text-right">Allowance</Th><Th className="text-right">Settlement</Th><Th>Status</Th><Th>Date</Th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-paper">
                  <Td><Link href={`/sales/trade-ins/${t.id}`} className="font-medium tabular-nums hover:underline">{t.number}</Link></Td>
                  <Td>{t.crm_accounts?.name}</Td>
                  <Td>{[t.year, t.make, t.model].filter(Boolean).join(" ")}</Td>
                  <Td className="num">{t.allowance != null ? money(t.allowance) : ""}</Td>
                  <Td className="num">{Number(t.settlement_amount) > 0 ? money(t.settlement_amount) : ""}</Td>
                  <Td><Badge tone={t.status === "accepted" ? "jade" : t.status === "cancelled" ? "neutral" : "amber"}>{t.status === "draft" ? "Offer" : t.status === "accepted" ? "Accepted" : "Undone"}</Badge></Td>
                  <Td className="whitespace-nowrap text-ink-soft">{date(t.created_at.slice(0, 10))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
