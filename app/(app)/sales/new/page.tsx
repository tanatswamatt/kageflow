import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { DocEditor } from "@/components/sales/doc-editor";
import { getContext } from "@/lib/context";
import { loadCatalog, loadCustomers, loadTaxes } from "@/lib/catalog";
import { today } from "@/lib/format";
import { DOC_LABEL, DOC_SLUG } from "@/lib/sales";
import { CURRENCIES, type DocType } from "@/lib/types";
import { saveDocument } from "../actions";

export const metadata: Metadata = { title: "New sales document" };

export default async function NewSalesDocPage({ searchParams }: { searchParams: Promise<{ type?: string; account?: string; deal?: string }> }) {
  const sp = await searchParams;
  const type = (["quote", "order", "invoice"].includes(sp.type ?? "") ? sp.type : "invoice") as DocType;
  const ctx = await getContext();
  const [customers, catalog, taxes, { data: deal }] = await Promise.all([
    loadCustomers(ctx),
    loadCatalog(ctx),
    loadTaxes(ctx),
    sp.deal ? ctx.supabase.from("crm_deals").select("id, name, account_id, contact_id, currency, value").eq("id", sp.deal).eq("company_id", ctx.companyId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const d = deal as { id: string; name: string; account_id: string; contact_id: string | null; currency: string; value: number } | null;
  const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const label = DOC_LABEL[type].one;

  return (
    <>
      <PageHeader title={`New ${label.toLowerCase()}`} description={d ? `For deal: ${d.name}` : undefined} back={{ href: `/sales/${DOC_SLUG[type]}`, label: DOC_LABEL[type].many }} />
      <div className="max-w-4xl">
        <DocEditor
          doc={{
            doc_type: type,
            account_id: d?.account_id ?? sp.account ?? null,
            contact_id: d?.contact_id ?? null,
            deal_id: d?.id ?? null,
            currency: d?.currency ?? ctx.company.base_currency,
            fx_rate: 1,
            issue_date: today(),
            due_date: null,
            valid_until: type === "quote" ? plusDays(14) : null,
            reference: null,
            notes: null,
            terms: null,
            credit_reason: null,
            lines: [],
          }}
          customers={customers}
          catalog={catalog}
          taxes={taxes}
          currencies={CURRENCIES}
          base={ctx.company.base_currency}
          defaultDays={ctx.company.default_payment_days}
          action={saveDocument}
        />
      </div>
    </>
  );
}
