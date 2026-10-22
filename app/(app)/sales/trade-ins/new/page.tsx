import type { Metadata } from "next";
import { Field, Notice, PageHeader, Panel, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { TradeInFields } from "@/components/finance/trade-in-fields";
import { getContext } from "@/lib/context";
import { fail } from "@/lib/forms";
import { createTradeIn } from "../actions";

export const metadata: Metadata = { title: "New trade-in" };

export default async function NewTradeInPage({ searchParams }: { searchParams: Promise<{ account?: string; order?: string; deal?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("sales.write")) fail("/sales/trade-ins", "Your role can't record trade-ins");
  const [{ data: orders }, { data: accounts }] = await Promise.all([
    ctx.supabase.from("sales_docs").select("id, number, crm_accounts(name)").eq("company_id", ctx.companyId).eq("doc_type", "order").eq("status", "open").order("created_at", { ascending: false }).limit(200),
    ctx.supabase.from("crm_accounts").select("id, name").eq("company_id", ctx.companyId).in("kind", ["customer", "prospect"]).order("name").limit(2000),
  ]);
  return (
    <>
      <PageHeader title="New trade-in" description="Record the car and the offer. Nothing is posted until you accept it." back={{ href: "/sales/trade-ins", label: "Trade-ins" }} />
      <Notice params={sp} />
      <Panel className="max-w-3xl">
        <form action={createTradeIn} className="flex flex-col gap-5">
          {sp.deal && <input type="hidden" name="deal_id" value={sp.deal} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Against order">
              <Select name="order_id" defaultValue={sp.order ?? ""}>
                <option value="">No order yet</option>
                {((orders ?? []) as unknown as { id: string; number: string | null; crm_accounts: { name: string } | null }[]).map((o) => <option key={o.id} value={o.id}>{o.number} · {o.crm_accounts?.name}</option>)}
              </Select>
            </Field>
            <Field label="Or customer">
              <Select name="account_id" defaultValue={sp.account ?? ""}>
                <option value="">Choose…</option>
                {((accounts ?? []) as { id: string; name: string }[]).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          </div>
          <TradeInFields vatVendor={!!ctx.company.vat_no?.trim()} />
          <div><SubmitButton>Save trade-in offer</SubmitButton></div>
        </form>
      </Panel>
    </>
  );
}
