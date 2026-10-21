import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Empty, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { date, label, money } from "@/lib/format";
import type { Journal } from "@/lib/types";

export const metadata: Metadata = { title: "Journals" };

type Row = Journal & { journal_lines: { debit: number }[] };

export default async function JournalsPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string; ok?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const status = params.status === "draft" || params.status === "posted" ? params.status : null;
  let query = ctx.supabase
    .from("journals")
    .select("*, journal_lines(debit)")
    .eq("company_id", ctx.companyId)
    .order("journal_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);
  const { data } = await query;
  const journals = (data ?? []) as Row[];
  const base = ctx.company.base_currency;

  return (
    <>
      <PageHeader
        title="Journals"
        description="Every entry in the ledger. Posted journals are locked; correct them with a reversal."
        actions={ctx.can("ledger.write") && <ButtonLink href="/accounting/journals/new" tone="primary">New journal</ButtonLink>}
      />
      <Notice params={params} />
      <nav className="mb-4 flex gap-1" aria-label="Journal status">
        {[[null, "All"], ["draft", "Drafts"], ["posted", "Posted"]].map(([k, l]) => (
          <Link key={l} href={k ? `/accounting/journals?status=${k}` : "/accounting/journals"} className={`rounded-full px-3 py-1 text-[13px] ${status === k ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>
            {l}
          </Link>
        ))}
      </nav>
      <Panel flush>
        {journals.length === 0 ? (
          <Empty title="No journals yet">Start with opening balances: a journal crediting Share capital or Retained earnings.</Empty>
        ) : (
          <Table>
            <thead>
              <tr><Th>Date</Th><Th>Number</Th><Th>Description</Th><Th>Source</Th><Th>Status</Th><Th className="text-right">Total ({base})</Th></tr>
            </thead>
            <tbody>
              {journals.map((j) => (
                <tr key={j.id} className="hover:bg-paper">
                  <Td className="whitespace-nowrap">{date(j.journal_date)}</Td>
                  <Td className="whitespace-nowrap tabular-nums"><Link href={`/accounting/journals/${j.id}`} className="font-medium hover:underline">{j.number ?? "Draft"}</Link></Td>
                  <Td className="max-w-md">
                    <Link href={`/accounting/journals/${j.id}`} className="hover:underline">{j.description}</Link>
                    {j.reversed_by && <span className="ml-2 text-xs text-ink-faint">reversed</span>}
                  </Td>
                  <Td className="text-ink-soft">{label(j.source_type)}</Td>
                  <Td><Badge tone={j.status === "posted" ? "jade" : "amber"}>{label(j.status)}</Badge></Td>
                  <Td className="num">{money(j.journal_lines.reduce((s, l) => s + Number(l.debit), 0), base)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
