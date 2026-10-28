import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Panel, Stat, Table, Td, Th, Empty } from "@/components/ui";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";

export const metadata: Metadata = { title: "All dealerships" };

type Row = {
  company_id: string; name: string; created_at: string; owner_name: string | null; owner_email: string | null;
  members: number; vehicles: number; in_stock: number; leads: number; invoices: number; invoiced: number;
  last_activity: string | null; last_sign_in: string | null;
};

const DAY = 86_400_000;
const ago = (iso: string | null) => {
  if (!iso) return "Never";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  return d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`;
};
const date = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

/** Pretan staff only: every dealership on Kageflow, how big it is and whether it's being used */
export default async function AdminPage() {
  const ctx = await getContext();
  const { data: isAdmin } = await ctx.supabase.rpc("is_platform_admin");
  if (!isAdmin) notFound();
  const { data, error } = await ctx.supabase.rpc("admin_overview");
  const rows = (data ?? []) as Row[];
  const now = Date.now();
  const active = rows.filter((r) => r.last_activity && now - new Date(r.last_activity).getTime() < 7 * DAY).length;
  const newThisWeek = rows.filter((r) => now - new Date(r.created_at).getTime() < 7 * DAY).length;
  const users = rows.reduce((n, r) => n + r.members, 0);

  return (
    <>
      <PageHeader title="All dealerships" description="Every dealership signed up to Kageflow. Only Pretan staff can see this page." />
      {error && <p className="mb-4 text-ember-700">Couldn&apos;t load the list: {error.message}</p>}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Dealerships" value={rows.length} sub={`${newThisWeek} new this week`} />
        <Stat label="Used in the last 7 days" value={active} sub={rows.length ? `${Math.round((active / rows.length) * 100)}% of dealerships` : undefined} />
        <Stat label="Users" value={users} />
        <Stat label="Cars in stock" value={rows.reduce((n, r) => n + r.in_stock, 0)} sub={`${rows.reduce((n, r) => n + r.vehicles, 0)} added in total`} />
      </div>
      <Panel flush>
        {rows.length === 0 ? (
          <Empty title="No dealerships yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Dealership</Th><Th>Signed up</Th><Th>Owner</Th><Th className="text-right">Users</Th>
                <Th className="text-right">Cars in stock</Th><Th className="text-right">Leads</Th><Th className="text-right">Invoices</Th>
                <Th>Last used</Th><Th>Last sign-in</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const idle = !r.last_activity || now - new Date(r.last_activity).getTime() > 14 * DAY;
                return (
                  <tr key={r.company_id}>
                    <Td><span className="font-medium">{r.name}</span></Td>
                    <Td className="whitespace-nowrap">{date(r.created_at)}</Td>
                    <Td>
                      {r.owner_name ?? "—"}
                      {r.owner_email && <a className="block text-xs text-shadow-700 hover:underline" href={`mailto:${r.owner_email}`}>{r.owner_email}</a>}
                    </Td>
                    <Td className="text-right tabular-nums">{r.members}</Td>
                    <Td className="text-right tabular-nums">{r.in_stock}</Td>
                    <Td className="text-right tabular-nums">{r.leads}</Td>
                    <Td className="text-right tabular-nums">
                      {r.invoices}
                      {r.invoices > 0 && <span className="block text-xs text-ink-faint">{money(r.invoiced)}</span>}
                    </Td>
                    <Td className={`whitespace-nowrap ${idle ? "text-amber-700" : ""}`}>{ago(r.last_activity)}</Td>
                    <Td className="whitespace-nowrap">{ago(r.last_sign_in)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
      <p className="mt-3 text-xs text-ink-faint">&ldquo;Last used&rdquo; is the last time anyone there saved anything. Amber means nothing saved for two weeks, so it&apos;s worth a call.</p>
    </>
  );
}
