import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Empty, Input, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { memberNames } from "@/lib/members";
import { date, label, money, personName } from "@/lib/format";
import { leadTone } from "@/lib/badges";
import { SOURCE_LABEL } from "@/lib/types";
import type { Lead, LeadStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Leads" };

const VIEWS: { key: string; label: string; statuses: LeadStatus[] }[] = [
  { key: "open", label: "Open", statuses: ["new", "contacted", "qualified"] },
  { key: "new", label: "New", statuses: ["new"] },
  { key: "converted", label: "Converted", statuses: ["converted"] },
  { key: "disqualified", label: "Disqualified", statuses: ["disqualified"] },
];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; error?: string; ok?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const view = VIEWS.find((v) => v.key === params.view) ?? VIEWS[0]!;
  const q = params.q?.trim();

  let query = ctx.supabase
    .from("crm_leads")
    .select("*")
    .eq("company_id", ctx.companyId)
    .in("status", view.statuses)
    .order("created_at", { ascending: false })
    .limit(200);
  if (q) {
    const term = `*${q.replace(/[*%,()]/g, " ")}*`;
    query = query.or(`first_name.ilike.${term},last_name.ilike.${term},company_name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
  }
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data }, names, { data: recent }] = await Promise.all([
    query,
    memberNames(),
    ctx.supabase.from("crm_leads").select("source").eq("company_id", ctx.companyId).gte("created_at", since).limit(5000),
  ]);
  const bySource = Object.entries(((recent ?? []) as { source: Lead["source"] }[]).reduce<Record<string, number>>((m, r) => ({ ...m, [r.source]: (m[r.source] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const leads = (data ?? []) as Lead[];

  return (
    <>
      <PageHeader
        title="Leads"
        description="Enquiries that haven't become customers yet. Qualify them, then convert to an account and deal."
        actions={ctx.can("crm.write") && <ButtonLink href="/crm/leads/new" tone="primary">New lead</ButtonLink>}
      />
      <Notice params={params} />
      {bySource.length > 0 && (
        <p className="mb-4 text-sm text-ink-soft">
          Last 30 days: {bySource.map(([src, n], i) => <span key={src}>{i > 0 && " · "}<strong className="font-semibold text-ink">{n}</strong> {SOURCE_LABEL[src as Lead["source"]] ?? label(src)}</span>)}
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1" aria-label="Lead views">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/crm/leads?view=${v.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`rounded-full px-3 py-1 text-[13px] ${v.key === view.key ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <form className="w-full sm:w-72">
          <input type="hidden" name="view" value={view.key} />
          <Input name="q" type="search" defaultValue={q} placeholder="Search name, company, email, phone" aria-label="Search leads" />
        </form>
      </div>
      <Panel flush>
        {leads.length === 0 ? (
          <Empty title={q ? "No leads match that search" : "No leads here yet"}>
            {ctx.can("crm.write") && !q && <Link className="text-shadow-700 hover:underline" href="/crm/leads/new">Add your first lead</Link>}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Lead</Th>
                <Th>Interested in</Th>
                <Th>Source</Th>
                <Th>Status</Th>
                <Th className="text-right">Est. value</Th>
                <Th>Owner</Th>
                <Th>Received</Th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="hover:bg-paper">
                  <Td>
                    <Link href={`/crm/leads/${l.id}`} className="font-medium hover:underline">
                      {personName(l) || l.company_name}
                    </Link>
                    {personName(l) && l.company_name && <div className="text-xs text-ink-faint">{l.company_name}</div>}
                  </Td>
                  <Td className="max-w-64 truncate text-ink-soft">{l.interest}</Td>
                  <Td>{SOURCE_LABEL[l.source] ?? label(l.source)}</Td>
                  <Td><Badge tone={leadTone[l.status]}>{label(l.status)}</Badge></Td>
                  <Td className="num">{l.estimated_value ? money(l.estimated_value, l.currency) : ""}</Td>
                  <Td className="text-ink-soft">{l.owner_id ? names.get(l.owner_id) : "Unassigned"}</Td>
                  <Td className="text-ink-soft">{date(l.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
