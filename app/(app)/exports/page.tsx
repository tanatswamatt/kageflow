import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Empty, Notice, PageHeader, Panel, Stat, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { getMembers } from "@/lib/members";
import { date } from "@/lib/format";
import {
  EXPORT_STATUSES, EXPORT_STATUS_LABEL, EXPORT_STATUS_TONE, shortVIN,
} from "@/lib/exports";
import type { ExportCase, ExportCaseStatus, ExportCheckResult } from "@/lib/types";

export const metadata: Metadata = { title: "Export cases" };

type CheckRow = { rule_code: string; rule_title: string; result: ExportCheckResult; note: string | null; blocking: boolean };
type Row = ExportCase & {
  crm_accounts: { name: string } | null;
  inventory_units: { make: string | null; model: string | null; year: number | null; serial_no: string } | null;
  sales_docs: { number: string | null; status: string } | null;
  export_case_checks: CheckRow[] | null;
  export_rulesets: { version: number } | null;
};

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "blocked", label: "Blocked" },
  { key: "in_review", label: "Needs review" },
  { key: "ready_for_approval", label: "Ready" },
  { key: "approved", label: "Awaiting release" },
  { key: "released", label: "Released" },
];

export default async function ExportsPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const members = await getMembers();
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const filter = sp.status && EXPORT_STATUSES.includes(sp.status as ExportCaseStatus) ? (sp.status as ExportCaseStatus) : null;

  let query = ctx.supabase
    .from("export_cases")
    .select("*, crm_accounts(name), inventory_units(make, model, year, serial_no), sales_docs(number, status), export_case_checks(rule_code, rule_title, result, note, blocking), export_rulesets(version)")
    .eq("company_id", ctx.companyId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (filter) query = query.eq("status", filter);

  const [{ data }, { count: blocked }, { count: ready }, { count: approved }, { count: released }] = await Promise.all([
    query,
    ctx.supabase.from("export_cases").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("status", "blocked"),
    ctx.supabase.from("export_cases").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("status", "ready_for_approval"),
    ctx.supabase.from("export_cases").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("status", "approved"),
    ctx.supabase.from("export_cases").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("status", "released"),
  ]);

  const rows = (data ?? []) as Row[];
  const canWrite = ctx.can("exports.write");
  const RULE_ORDER = ["buyer_destination", "vehicle_sale_match", "finance_title_clear", "customs_documents", "payment_conditions", "proof_of_export"];
  const sortedChecks = (row: Row) => (row.export_case_checks ?? []).slice().sort(
    (a, b) => RULE_ORDER.indexOf(a.rule_code) - RULE_ORDER.indexOf(b.rule_code),
  );

  function nextStep(row: Row): string {
    const checks = sortedChecks(row);
    const first = checks.find((c) => c.result !== "pass");
    if (row.status === "blocked" || row.status === "in_review") {
      if (!first) return canWrite ? "Run the checklist again" : "Awaiting export staff";
      return first.note ?? first.rule_title;
    }
    if (row.status === "ready_for_approval") return "An owner or admin reviews the evidence and approves release";
    if (row.status === "approved") return "Release the vehicle as a separate, recorded action";
    if (row.status === "released") return `Released ${date(row.released_at)}`;
    if (row.status === "cancelled") return "Cancelled";
    return "Run the checklist";
  }

  function ownerFor(row: Row): string {
    const checks = sortedChecks(row);
    const first = checks.find((c) => c.result !== "pass");
    const id = first?.rule_code === "proof_of_export" ? row.proof_of_export_owner : row.owner_id;
    return (id && names.get(id)) || "Unassigned";
  }

  return (
    <>
      <PageHeader
        title="Export cases"
        description="One case per exported vehicle, tied to the existing buyer, stock unit and sales order. Readiness is a versioned checklist with evidence, and release waits for a recorded approval."
        actions={
          <>
            {ctx.can("company.manage") && <ButtonLink href="/exports/checklist">Manage checklist</ButtonLink>}
            {canWrite && <ButtonLink href="/exports/new" tone="primary">New export case</ButtonLink>}
          </>
        }
      />
      <Notice params={sp} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Blocked" value={blocked ?? 0} sub="A blocking requirement is missing or failed" />
        <Stat label="Ready for approval" value={ready ?? 0} sub="Every blocking check passes" />
        <Stat label="Awaiting release" value={approved ?? 0} sub="Approved, not yet released" />
        <Stat label="Released" value={released ?? 0} sub="Approval and release recorded" />
      </div>

      <nav className="mb-4 flex flex-wrap gap-1" aria-label="Filter export cases">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/exports" : `/exports?status=${f.key}`}
            className={`rounded-full px-3 py-1 text-[13px] ${(filter ?? "all") === f.key ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      <Panel flush>
        {rows.length === 0 ? (
          <Empty title={filter ? "No export cases in this view" : "No export cases yet"}>
            {canWrite
              ? "Open a case from a confirmed sales order that has a vehicle on it. The buyer, car and sale stay in their existing records."
              : "Ask a colleague with sales access to open an export case."}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Case</Th><Th>Buyer and vehicle</Th><Th>Sale</Th><Th>Route</Th><Th>Checklist</Th><Th>Status</Th><Th>Next step</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const checks = row.export_case_checks ?? [];
                const nonPass = checks.filter((c) => c.result !== "pass").length;
                const vehicle = [row.inventory_units?.year, row.inventory_units?.make, row.inventory_units?.model].filter(Boolean).join(" ");
                return (
                  <tr key={row.id} className="hover:bg-paper">
                    <Td className="whitespace-nowrap">
                      <Link href={`/exports/${row.id}`} className="font-medium tabular-nums hover:underline">{row.case_no ?? "Draft"}</Link>
                      <div className="text-[12px] text-ink-faint">Opened {date(row.created_at)}</div>
                    </Td>
                    <Td>
                      <div className="font-medium">{row.crm_accounts?.name ?? "Buyer missing"}</div>
                      <div className="text-[12px] text-ink-soft">{vehicle || "Vehicle"} · {shortVIN(row.inventory_units?.serial_no)}</div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {row.sales_docs?.number ?? "—"}
                      <div className="text-[12px] text-ink-faint">{row.sales_docs?.status}</div>
                    </Td>
                    <Td className="whitespace-nowrap">{row.origin_country} → {row.destination_country}<div className="text-[12px] text-ink-faint">{row.incoterm}</div></Td>
                    <Td className="whitespace-nowrap">
                      {!canWrite ? (
                        <Badge>Restricted</Badge>
                      ) : nonPass === 0 ? (
                        <Badge tone="jade">All checks pass</Badge>
                      ) : (
                        <Badge tone="ember">{nonPass} open</Badge>
                      )}
                      <div className="mt-1 text-[12px] text-ink-faint">v{row.export_rulesets?.version ?? "?"}</div>
                    </Td>
                    <Td><Badge tone={EXPORT_STATUS_TONE[row.status]}>{EXPORT_STATUS_LABEL[row.status]}</Badge></Td>
                    <Td className="max-w-[280px]">
                      <div className="text-[13px]">{nextStep(row)}</div>
                      <div className="mt-0.5 text-[12px] text-ink-faint">Owner: {canWrite ? ownerFor(row) : "Restricted"}</div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
