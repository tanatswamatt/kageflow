import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { QuickAdd } from "@/components/inventory/quick-add";
import { getContext } from "@/lib/context";
import { fail } from "@/lib/forms";
import { registerPhotos, saveAdvert } from "../actions";
import { decodeVin, quickAddVehicle } from "../quick-actions";

export const metadata: Metadata = { title: "Add a car" };

export default async function QuickAddPage({ searchParams }: { searchParams: Promise<{ vin?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail("/inventory/units", "Your role can't add stock");
  const [{ data: accts }, { data: sup }] = await Promise.all([
    ctx.supabase.from("accounts").select("id, code, name, system_key, type").eq("company_id", ctx.companyId).eq("is_active", true).in("type", ["asset", "liability"]).order("code"),
    ctx.supabase.from("crm_accounts").select("id, name").eq("company_id", ctx.companyId).order("name").limit(2000),
  ]);
  type A = { id: string; code: string; name: string; system_key: string | null; type: string };
  const accounts = (accts ?? []) as A[];
  const payFrom = [
    ...accounts.filter((a) => a.system_key === "payables").map((a) => ({ id: a.id, label: "Owe the seller" })),
    ...accounts.filter((a) => a.system_key === "bank" || (a.type === "asset" && a.code < "1100" && !a.system_key)).map((a) => ({ id: a.id, label: a.name })),
  ];
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Add a car" description="Scan the VIN, check the details, take the photos, set the price." back={{ href: "/inventory/units", label: "Vehicles" }} />
      <QuickAdd
        companyId={ctx.companyId}
        initialVin={sp.vin ?? ""}
        payFrom={payFrom}
        suppliers={((sup ?? []) as { id: string; name: string }[]).map((s) => ({ id: s.id, label: s.name }))}
        vatVendor={!!ctx.company.vat_no?.trim() && ctx.rules.notionalInputTax}
        canCost={ctx.can("inventory.costs")}
        decode={decodeVin}
        add={quickAddVehicle}
        registerPhotos={registerPhotos}
        saveAdvert={saveAdvert}
      />
    </div>
  );
}
