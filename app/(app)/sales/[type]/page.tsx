import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Empty, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { date, money } from "@/lib/format";
import { docTone } from "@/lib/badges";
import { DOC_LABEL, DOC_SLUGS, docStatusLabel, docTitle } from "@/lib/sales";
import type { SalesDoc } from "@/lib/types";

export const metadata: Metadata = { title: "Sales" };

type Row = SalesDoc & { crm_accounts: { name: string } | null };

const FILTERS: Record<string, { key: string; label: string }[]> = {
  quote: [{ key: "all", label: "All" }, { key: "draft", label: "Drafts" }, { key: "sent", label: "Sent" }, { key: "accepted", label: "Accepted" }],
  order: [{ key: "all", label: "All" }, { key: "draft", label: "Drafts" }, { key: "open", label: "Open" }, { key: "fulfilled", label: "Fulfilled" }],
  invoice: [{ key: "all", label: "All" }, { key: "draft", label: "Drafts" }, { key: "unpaid", label: "Unpaid" }, { key: "overdue", label: "Overdue" }, { key: "paid", label: "Paid" }],
  credit_note: [{ key: "all", label: "All" }, { key: "draft", label: "Drafts" }, { key: "issued", label: "Issued" }],
};

export default async function SalesListPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<{ f?: string; error?: string; ok?: string }> }) {
  const { type: slug } = await params;
  const sp = await searchParams;
  const type = DOC_SLUGS[slug];
  if (!type) notFound();
  const ctx = await getContext();
  const f = sp.f ?? "all";
  const today = new Date().toISOString().slice(0, 10);

  let q = ctx.supabase.from("sales_docs").select("*, crm_accounts(name)").eq("company_id", ctx.companyId).eq("doc_type", type)
    .order("issue_date", { ascending: false }).order("created_at", { ascending: false }).limit(300);
  if (["draft", "sent", "accepted", "open", "fulfilled", "issued"].includes(f)) q = q.eq("status", f);
  if (f === "unpaid") q = q.eq("status", "issued").gt("amount_due", 0);
  if (f === "overdue") q = q.eq("status", "issued").gt("amount_due", 0).lt("due_date", today);
  if (f === "paid") q = q.eq("status", "issued").lte("amount_due", 0);
  const { data } = await q;
  const docs = (data ?? []) as Row[];
  const labels = DOC_LABEL[type];
  const canCreate = ctx.can("sales.write") && type !== "credit_note";
  const showDue = type === "invoice";

  const dueByCur = new Map<string, number>();
  if (showDue) for (const d of docs) if (d.status === "issued" && Number(d.amount_due) > 0) dueByCur.set(d.currency, (dueByCur.get(d.currency) ?? 0) + Number(d.amount_due));

  return (
    <>
      <PageHeader
        title={labels.many}
        description={
          type === "credit_note"
            ? "Credit notes are raised from an issued invoice to correct or refund it."
            : showDue && dueByCur.size > 0
              ? <>Outstanding in this view: {[...dueByCur].map(([c, v]) => <strong key={c} className="mr-2 font-semibold text-ink">{money(v, c)}</strong>)}</>
              : undefined
        }
        actions={canCreate && <ButtonLink href={`/sales/new?type=${type}`} tone="primary">New {labels.one.toLowerCase()}</ButtonLink>}
      />
      <Notice params={sp} />
      <nav className="mb-4 flex flex-wrap gap-1" aria-label="Filter">
        {FILTERS[type]!.map((x) => (
          <Link key={x.key} href={`/sales/${slug}${x.key === "all" ? "" : `?f=${x.key}`}`} className={`rounded-full px-3 py-1 text-[13px] ${f === x.key ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>
            {x.label}
          </Link>
        ))}
      </nav>
      <Panel flush>
        {docs.length === 0 ? (
          <Empty title={`No ${labels.many.toLowerCase()} here`}>
            {type === "quote" && "Open a deal and choose Create quote, or start one here."}
            {type === "invoice" && "Invoice from a confirmed order, or start a direct invoice."}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th><Th>Customer</Th><Th>Date</Th>
                <Th>{type === "quote" ? "Valid until" : type === "invoice" ? "Due" : "Reference"}</Th>
                <Th>Status</Th><Th className="text-right">Total</Th>
                {showDue && <Th className="text-right">Due</Th>}
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const st = docStatusLabel(d);
                return (
                  <tr key={d.id} className="hover:bg-paper">
                    <Td className="whitespace-nowrap"><Link href={`/sales/doc/${d.id}`} className="font-medium tabular-nums hover:underline">{docTitle(d)}</Link></Td>
                    <Td>{d.crm_accounts?.name}</Td>
                    <Td className="whitespace-nowrap text-ink-soft">{date(d.issue_date)}</Td>
                    <Td className={`whitespace-nowrap ${st.overdue ? "font-medium text-ember-700" : "text-ink-soft"}`}>
                      {type === "quote" ? date(d.valid_until) : type === "invoice" ? date(d.due_date) : d.reference}
                    </Td>
                    <Td><Badge tone={st.overdue ? "ember" : st.text === "Paid" ? "jade" : docTone[d.status]}>{st.text}</Badge></Td>
                    <Td className="num">{money(d.total, d.currency)}</Td>
                    {showDue && <Td className="num">{d.status === "issued" && Number(d.amount_due) > 0 ? money(d.amount_due, d.currency) : ""}</Td>}
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
