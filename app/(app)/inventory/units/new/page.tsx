import type { Metadata } from "next";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { UnitFields } from "@/components/inventory/unit-fields";
import { getContext } from "@/lib/context";
import { createUnit } from "../../actions";

export const metadata: Metadata = { title: "Add vehicle" };

export default async function NewUnitPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const [{ data: products }, { data: suppliers }] = await Promise.all([
    ctx.supabase.from("products").select("id, name").eq("company_id", ctx.companyId).eq("tracking", "serial").eq("is_active", true).order("name"),
    ctx.supabase.from("crm_accounts").select("id, name").eq("company_id", ctx.companyId).order("name").limit(1000),
  ]);
  return (
    <>
      <PageHeader title="Add vehicle" description="Add the vehicle first, then post its purchase price and other costs from its page." back={{ href: "/inventory/units", label: "Vehicles" }} />
      <Notice params={sp} />
      <Panel className="max-w-4xl">
        <form action={createUnit} className="flex flex-col gap-6">
          <UnitFields products={(products ?? []) as { id: string; name: string }[]} suppliers={(suppliers ?? []) as { id: string; name: string }[]} base={ctx.company.base_currency} />
          <div><SubmitButton>Add vehicle</SubmitButton></div>
        </form>
      </Panel>
    </>
  );
}
