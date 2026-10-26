import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Empty, Notice, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { mergeCustomers } from "./actions";

export const metadata: Metadata = { title: "Possible duplicates" };

type G = { matched_on: string; match_value: string; ids: string[]; names: string[] };

export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.rpc("duplicate_accounts", { p_company: ctx.companyId });
  // the same pair can match on several keys; show each set of records once
  const seen = new Set<string>();
  const groups = ((data ?? []) as G[]).filter((g) => {
    const key = [...g.ids].sort().join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const ids = [...new Set(groups.flatMap((g) => g.ids))];
  const { data: accts } = ids.length ? await ctx.supabase.from("crm_accounts").select("id, name, kind, email, phone, vat_no, created_at").in("id", ids) : { data: [] };
  const byId = new Map(((accts ?? []) as { id: string; name: string; kind: string; email: string | null; phone: string | null; vat_no: string | null; created_at: string }[]).map((a) => [a.id, a]));
  const canMerge = ctx.can("company.manage");

  return (
    <>
      <PageHeader title="Possible duplicates" description="The same person or company entered twice, for example once from a portal lead and once from your old accounting system. Merging moves every quote, invoice, payment, finance application and message onto one record." back={{ href: "/crm/accounts", label: "Accounts" }} />
      <Notice params={sp} />
      {groups.length === 0 ? <Panel><Empty title="No duplicates found">Kageflow checks email, phone in any format, VAT number and name (ignoring Pty Ltd).</Empty></Panel> : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <Panel key={g.ids.join()} title={<span className="flex items-center gap-2">Same {g.matched_on} <Badge>{g.ids.length} records</Badge></span>}>
              <form action={mergeCustomers} className="flex flex-col gap-2">
                {g.ids.map((id, i) => {
                  const a = byId.get(id);
                  return (
                    <label key={id} className="flex items-start gap-3 rounded-[var(--radius-control)] border border-line p-3 text-sm has-[:checked]:border-jade-600 has-[:checked]:bg-jade-50">
                      <input type="hidden" name="ids" value={id} />
                      <input type="radio" name="keep" value={id} defaultChecked={i === 0} disabled={!canMerge} className="mt-1 accent-jade-700" />
                      <span className="min-w-0">
                        <Link href={`/crm/accounts/${id}`} className="font-medium hover:underline">{a?.name ?? g.names[i]}</Link> <span className="text-xs text-ink-faint">{a?.kind}</span>
                        <span className="block text-[13px] text-ink-soft">{[a?.email, a?.phone, a?.vat_no && `VAT ${a.vat_no}`].filter(Boolean).join(" · ") || "No contact details"}</span>
                      </span>
                    </label>
                  );
                })}
                {canMerge ? <div><SubmitButton size="sm" confirm="Merge these records into the one you chose? This can't be undone.">Merge into the chosen record</SubmitButton></div> : <p className="text-xs text-ink-faint">Owners and admins can merge.</p>}
              </form>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
