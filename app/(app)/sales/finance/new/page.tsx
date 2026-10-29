import type { Metadata } from "next";
import { Field, Notice, PageHeader, Panel, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { fail } from "@/lib/forms";
import { createApplication } from "../actions";

export const metadata: Metadata = { title: "New finance application" };

export default async function NewFinancePage({ searchParams }: { searchParams: Promise<{ account?: string; order?: string; unit?: string; deal?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("sales.write")) fail("/sales/finance", "Your role can't start finance applications");
  const [{ data: orders }, { data: accounts }, { data: units }] = await Promise.all([
    ctx.supabase.from("sales_docs").select("id, number, total, crm_accounts(name)").eq("company_id", ctx.companyId).eq("doc_type", "order").eq("status", "open").order("created_at", { ascending: false }).limit(200),
    ctx.supabase.from("crm_accounts").select("id, name").eq("company_id", ctx.companyId).in("kind", ["customer", "prospect"]).order("name").limit(2000),
    ctx.supabase.from("inventory_units").select("id, stock_no, make, model, year").eq("company_id", ctx.companyId).in("status", ["in_stock", "reserved", "in_transit", "listed"]).order("created_at", { ascending: false }).limit(1000),
  ]);
  return (
    <>
      <PageHeader title="New finance application" description="Starting from an order fills in the price, deposit and trade-in for you." back={{ href: "/sales/finance", label: "Finance applications" }} />
      <Notice params={sp} />
      <Panel className="max-w-xl">
        <form action={createApplication} className="flex flex-col gap-4">
          {sp.deal && <input type="hidden" name="deal_id" value={sp.deal} />}
          <Field label="From an order (recommended)">
            <Select name="order_id" defaultValue={sp.order ?? ""}>
              <option value="">No order yet</option>
              {((orders ?? []) as unknown as { id: string; number: string | null; total: number; crm_accounts: { name: string } | null }[]).map((o) => (
                <option key={o.id} value={o.id}>{o.number} · {o.crm_accounts?.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Or the customer">
            <Select name="account_id" defaultValue={sp.account ?? ""}>
              <option value="">Choose…</option>
              {((accounts ?? []) as { id: string; name: string }[]).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Vehicle">
            <Select name="unit_id" defaultValue={sp.unit ?? ""}>
              <option value="">From the order, or none</option>
              {((units ?? []) as { id: string; stock_no: string | null; make: string | null; model: string | null; year: number | null }[]).map((u) => (
                <option key={u.id} value={u.id}>{u.stock_no} · {[u.year, u.make, u.model].filter(Boolean).join(" ")}</option>
              ))}
            </Select>
          </Field>
          <div><SubmitButton pendingText="Starting…">Start application</SubmitButton></div>
        </form>
      </Panel>
    </>
  );
}
