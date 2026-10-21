import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { BillEditor } from "@/components/purchases/bill-editor";
import { getContext } from "@/lib/context";
import { fail } from "@/lib/forms";
import { today } from "@/lib/format";
import { loadBillOptions } from "@/lib/purchases-data";
import { saveBill } from "../../actions";

export const metadata: Metadata = { title: "New bill" };

export default async function NewBillPage({ searchParams }: { searchParams: Promise<{ mode?: string; supplier?: string; unit?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("purchases.write")) fail("/purchases/bills", "Only owners, admins and accountants can enter bills");
  const mode = sp.mode === "expense" ? "expense" : "bill";
  const o = await loadBillOptions(ctx);
  const vatVendor = !!ctx.company.vat_no?.trim();
  const std = o.taxes.find((t) => t.code === (vatVendor ? "STD" : "NONE"))?.id ?? "";
  return (
    <>
      <PageHeader
        title={mode === "expense" ? "Record an expense" : "New supplier bill"}
        description={mode === "expense" ? "Something you already paid for: fuel, a slip, a card payment." : "A supplier invoice you'll pay later. Stock and vehicle costs update automatically when you post it."}
        back={{ href: "/purchases/bills", label: "Bills and expenses" }}
      />
      <div className="max-w-3xl">
        <BillEditor
          mode={mode}
          initial={{
            supplier_id: sp.supplier ?? null, supplier_ref: null, bill_date: today(), due_date: null,
            currency: ctx.company.base_currency, fx_rate: 1, paid_from_account_id: null, notes: null,
            lines: sp.unit ? [{ kind: "vehicle", unit_id: sp.unit, cost_kind: "transport", description: "", quantity: "1", unit_price: "", tax_rate_id: std }] : [],
          }}
          {...o}
          baseCurrency={ctx.company.base_currency}
          vatVendor={vatVendor}
          action={saveBill}
        />
      </div>
    </>
  );
}
