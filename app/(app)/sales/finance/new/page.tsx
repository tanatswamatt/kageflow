import type { Metadata } from "next";
import { Field, Notice, PageHeader, Panel, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { AccountPicker, type PickerAccount } from "@/components/crm/account-picker";
import { getContext } from "@/lib/context";
import { moneyFor } from "@/lib/format";
import { fail } from "@/lib/forms";
import { createApplication } from "../actions";

export const metadata: Metadata = { title: "New finance application" };

type Unit = { id: string; stock_no: string | null; make: string | null; model: string | null; year: number | null; advert_price: number | null; list_price: number | null; list_currency: string };

export default async function NewFinancePage({ searchParams }: { searchParams: Promise<{ account?: string; order?: string; unit?: string; deal?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("sales.write")) fail("/sales/finance", "Your role can't start finance applications");
  const money = moneyFor(ctx.company.base_currency);
  const [{ data: orders }, { data: accounts }, { data: units }] = await Promise.all([
    ctx.supabase.from("sales_docs").select("id, number, total, crm_accounts(name)").eq("company_id", ctx.companyId).eq("doc_type", "order").eq("status", "open").order("created_at", { ascending: false }).limit(200),
    ctx.supabase.from("crm_accounts").select("id, name, email, phone").eq("company_id", ctx.companyId).in("kind", ["customer", "prospect"]).order("name").limit(3000),
    ctx.supabase.from("inventory_units").select("id, stock_no, make, model, year, advert_price, list_price, list_currency").eq("company_id", ctx.companyId).in("status", ["in_stock", "reserved", "in_transit", "listed"]).order("created_at", { ascending: false }).limit(1000),
  ]);
  const orderList = (orders ?? []) as unknown as { id: string; number: string | null; total: number; crm_accounts: { name: string } | null }[];

  return (
    <>
      <PageHeader title="New finance application" description="Pick the customer and the car they want to finance. No order is needed: the car's asking price is used. Starting from an order also fills in the deposit and trade-in." back={{ href: "/sales/finance", label: "Finance applications" }} />
      <Notice params={sp} />
      <Panel className="max-w-xl">
        <form action={createApplication} className="flex flex-col gap-5">
          {sp.deal && <input type="hidden" name="deal_id" value={sp.deal} />}
          <AccountPicker accounts={(accounts ?? []) as PickerAccount[]} defaultValue={sp.account} label="Customer" noun="customer" />
          <Field label="Car to finance" hint="Any car in stock or on a supplier's floor. The asking price becomes the purchase price">
            <Select name="unit_id" defaultValue={sp.unit ?? ""}>
              <option value="">Not chosen yet</option>
              {((units ?? []) as Unit[]).map((u) => {
                const price = u.advert_price ?? u.list_price;
                return <option key={u.id} value={u.id}>{u.stock_no} · {[u.year, u.make, u.model].filter(Boolean).join(" ")}{price != null ? ` · ${money(price, u.list_currency)}` : ""}</option>;
              })}
            </Select>
          </Field>
          {orderList.length > 0 && (
            <Field label="Or start from an order (optional)" hint="Uses the order's customer, car, price, deposit and trade-in instead">
              <Select name="order_id" defaultValue={sp.order ?? ""}>
                <option value="">No order</option>
                {orderList.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.crm_accounts?.name}</option>)}
              </Select>
            </Field>
          )}
          <div><SubmitButton pendingText="Starting…">Start application</SubmitButton></div>
        </form>
      </Panel>
    </>
  );
}
