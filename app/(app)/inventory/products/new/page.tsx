import type { Metadata } from "next";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ProductFields } from "@/components/inventory/product-fields";
import { getContext } from "@/lib/context";
import type { TaxRate } from "@/lib/types";
import { saveProduct } from "../../actions";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { data: taxes } = await ctx.supabase.from("tax_rates").select("*").eq("company_id", ctx.companyId).eq("is_active", true).order("rate", { ascending: false });
  return (
    <>
      <PageHeader title="Add product or service" back={{ href: "/inventory/products", label: "Products" }} />
      <Notice params={sp} />
      <Panel className="max-w-3xl">
        <form action={saveProduct} className="flex flex-col gap-6">
          <ProductFields taxes={(taxes ?? []) as TaxRate[]} base={ctx.company.base_currency} />
          <div><SubmitButton>Add product</SubmitButton></div>
        </form>
      </Panel>
    </>
  );
}
