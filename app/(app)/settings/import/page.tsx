import type { Metadata } from "next";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { Importer } from "@/components/import/importer";
import { getContext } from "@/lib/context";
import { checkMatches, importRows } from "./actions";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { data: accounts } = await ctx.supabase.from("accounts").select("id, code, name, system_key").eq("company_id", ctx.companyId).in("type", ["asset", "liability", "equity"]).eq("is_active", true).order("code");
  return (
    <>
      <PageHeader title="Import" description="Bring your existing records in from a spreadsheet. Suggested order: customers, contacts, products, vehicles, then opening balances." />
      <Notice params={sp} />
      <Panel className="max-w-5xl">
        <Importer
          action={importRows}
          check={checkMatches}
          canLedger={ctx.can("ledger.write")}
          creditAccounts={((accounts ?? []) as { id: string; code: string; name: string; system_key: string | null }[]).map((a) => ({ id: a.id, label: `${a.code} ${a.name}`, key: a.system_key }))}
        />
      </Panel>
    </>
  );
}
