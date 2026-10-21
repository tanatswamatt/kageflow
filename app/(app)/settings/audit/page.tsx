import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Empty, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { memberNames } from "@/lib/members";
import { dateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

type Entry = {
  id: number;
  table_name: string;
  record_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  actor: string | null;
  at: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

const TABLES: Record<string, string> = {
  companies: "Company",
  company_members: "Team",
  accounts: "Chart of accounts",
  journals: "Journal",
  journal_lines: "Journal line",
  fiscal_periods: "Period",
  posting_rules: "Posting rule",
  crm_accounts: "Account",
  crm_contacts: "Contact",
  crm_leads: "Lead",
  crm_deals: "Deal",
  crm_pipeline_stages: "Pipeline stage",
};

const IGNORED = new Set(["updated_at", "created_at", "id", "company_id"]);

function changes(e: Entry): string {
  if (e.action === "INSERT") return String(e.new_data?.name ?? e.new_data?.description ?? e.new_data?.subject ?? e.new_data?.number ?? e.new_data?.code ?? "");
  if (e.action === "DELETE") return String(e.old_data?.name ?? e.old_data?.description ?? e.old_data?.number ?? e.old_data?.first_name ?? "");
  const keys = Object.keys(e.new_data ?? {}).filter((k) => !IGNORED.has(k) && JSON.stringify(e.old_data?.[k]) !== JSON.stringify(e.new_data?.[k]));
  return keys
    .slice(0, 4)
    .map((k) => `${k.replace(/_/g, " ")}: ${short(e.old_data?.[k])} → ${short(e.new_data?.[k])}`)
    .join("; ");
}

function short(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ table?: string; before?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("audit.read")) {
    return <Panel><p className="text-ink-soft">Only owners, admins and accountants can see the audit log.</p></Panel>;
  }
  let query = ctx.supabase.from("audit_log").select("*").eq("company_id", ctx.companyId).order("id", { ascending: false }).limit(100);
  if (params.table && TABLES[params.table]) query = query.eq("table_name", params.table);
  if (params.before && /^\d+$/.test(params.before)) query = query.lt("id", Number(params.before));
  const [{ data }, names] = await Promise.all([query, memberNames()]);
  const entries = (data ?? []) as Entry[];
  const last = entries.at(-1);

  return (
    <>
      <PageHeader title="Audit log" description="Every change to company data, who made it and when. Entries can't be edited or deleted." />
      <nav className="mb-4 flex flex-wrap gap-1" aria-label="Filter by record type">
        <Link href="/settings/audit" className={`rounded-full px-3 py-1 text-[13px] ${!params.table ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>All</Link>
        {Object.entries(TABLES).map(([k, v]) => (
          <Link key={k} href={`/settings/audit?table=${k}`} className={`rounded-full px-3 py-1 text-[13px] ${params.table === k ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>{v}</Link>
        ))}
      </nav>
      <Panel flush>
        {entries.length === 0 ? (
          <Empty title="No entries" />
        ) : (
          <Table>
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Record</Th><Th>Action</Th><Th>Change</Th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-ink-soft">{dateTime(e.at)}</Td>
                  <Td className="whitespace-nowrap">{e.actor ? (names.get(e.actor) ?? "Former member") : "System"}</Td>
                  <Td className="whitespace-nowrap">{TABLES[e.table_name] ?? e.table_name}</Td>
                  <Td><Badge tone={e.action === "DELETE" ? "ember" : e.action === "INSERT" ? "jade" : "shadow"}>{e.action === "INSERT" ? "Created" : e.action === "UPDATE" ? "Changed" : "Deleted"}</Badge></Td>
                  <Td className="max-w-xl break-words text-ink-soft">{changes(e)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {last && entries.length === 100 && (
        <div className="mt-4">
          <Link className="text-shadow-700 hover:underline" href={`/settings/audit?${params.table ? `table=${params.table}&` : ""}before=${last.id}`}>Older entries</Link>
        </div>
      )}
    </>
  );
}
