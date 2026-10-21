import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Empty, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { date, money } from "@/lib/format";
import { billStatus, billTitle, type Bill } from "@/lib/purchases";

export const metadata: Metadata = { title: "Bills and expenses" };

type Row = Bill & { crm_accounts: { name: string } | null };
const FILTERS = [
  ["open", "To pay"],
  ["draft", "Drafts"],
  ["bills", "All bills"],
  ["expenses", "Expenses"],
  ["void", "Void"],
] as const;

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const f = FILTERS.some(([k]) => k === sp.f) ? sp.f! : "open";
  const ctx = await getContext();
  let query = ctx.supabase.from("purchase_bills").select("*, crm_accounts(name)").eq("company_id", ctx.companyId);
  if (f === "open") query = query.eq("status", "posted").gt("amount_due", 0);
  if (f === "draft") query = query.eq("status", "draft");
  if (f === "bills") query = query.neq("status", "void").is("paid_from_account_id", null);
  if (f === "expenses") query = query.neq("status", "void").not("paid_from_account_id", "is", null);
  if (f === "void") query = query.eq("status", "void").not("number", "is", null);
  const { data } = await query.order(f === "open" ? "due_date" : "bill_date", { ascending: f === "open" }).order("created_at", { ascending: false }).limit(500);
  let rows = (data ?? []) as Row[];
  const q = sp.q?.trim().toLowerCase();
  if (q) rows = rows.filter((b) => [b.number, b.supplier_ref, b.crm_accounts?.name].some((v) => (v ?? "").toLowerCase().includes(q)));
  const owed = rows.filter((b) => b.status === "posted").reduce<Record<string, number>>((m, b) => ({ ...m, [b.currency]: (m[b.currency] ?? 0) + Number(b.amount_due) }), {});
  const canWrite = ctx.can("purchases.write");

  return (
    <>
      <PageHeader
        title="Bills and expenses"
        description="Supplier invoices you owe, and costs you paid on the spot. Posting puts them in the books, VAT and stock."
        actions={canWrite && (
          <>
            <ButtonLink href="/purchases/bills/new?mode=expense">Record expense</ButtonLink>
            <ButtonLink href="/purchases/bills/new" tone="primary">New bill</ButtonLink>
          </>
        )}
      />
      <Notice params={sp} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1">
          {FILTERS.map(([k, l]) => (
            <Link key={k} href={`/purchases/bills?f=${k}`} className={`rounded-full px-3 py-1 text-[13px] ${f === k ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>{l}</Link>
          ))}
        </nav>
        <form className="flex gap-2">
          <input type="hidden" name="f" value={f} />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search supplier or number" aria-label="Search bills" className="h-9 w-56 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm" />
        </form>
      </div>
      {f === "open" && Object.keys(owed).length > 0 && (
        <p className="mb-4 text-sm text-ink-soft">You owe {Object.entries(owed).map(([c, v]) => money(v, c)).join(" and ")} on these bills.</p>
      )}
      <Panel flush>
        {rows.length === 0 ? (
          <Empty title={f === "open" ? "Nothing to pay" : "Nothing here"}>{f === "open" ? "Posted bills with a balance show here, oldest due first." : null}</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Number</Th><Th>Supplier</Th><Th>Their ref</Th><Th>Date</Th><Th>Due</Th><Th className="text-right">Total</Th><Th className="text-right">Owed</Th><Th>Status</Th></tr></thead>
            <tbody>
              {rows.map((b) => {
                const st = billStatus(b);
                return (
                  <tr key={b.id} className="hover:bg-paper">
                    <Td className="whitespace-nowrap"><Link href={`/purchases/bills/${b.id}`} className="font-medium tabular-nums hover:underline">{billTitle(b)}</Link></Td>
                    <Td>{b.crm_accounts?.name}</Td>
                    <Td className="text-ink-soft">{b.supplier_ref}</Td>
                    <Td className="whitespace-nowrap text-ink-soft">{date(b.bill_date)}</Td>
                    <Td className="whitespace-nowrap text-ink-soft">{b.paid_from_account_id ? "" : date(b.due_date)}</Td>
                    <Td className="num">{money(b.total, b.currency)}</Td>
                    <Td className="num">{Number(b.amount_due) > 0 ? money(b.amount_due, b.currency) : ""}</Td>
                    <Td><Badge tone={st.tone}>{st.text}</Badge></Td>
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
