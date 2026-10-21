import type { Metadata } from "next";
import { Badge, Empty, Field, Input, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { date, label } from "@/lib/format";
import type { Period } from "@/lib/types";
import { createPeriod, deletePeriod, setPeriodStatus } from "../actions";

export const metadata: Metadata = { title: "Periods" };

const tone = { open: "jade", closed: "amber", locked: "ember" } as const;
const NEXT: Record<Period["status"], { to: Period["status"]; label: string }[]> = {
  open: [{ to: "closed", label: "Close" }, { to: "locked", label: "Lock" }],
  closed: [{ to: "open", label: "Reopen" }, { to: "locked", label: "Lock" }],
  locked: [{ to: "open", label: "Unlock" }],
};

export default async function PeriodsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("fiscal_periods").select("*").eq("company_id", ctx.companyId).order("start_date", { ascending: false });
  const periods = (data ?? []) as Period[];
  const canWrite = ctx.can("ledger.write");

  return (
    <>
      <PageHeader
        title="Periods"
        description="Closed and locked periods reject new postings. Only an owner can unlock a locked period. Dates outside any period stay open."
      />
      <Notice params={params} />
      <div className={`grid gap-6 ${canWrite ? "lg:grid-cols-[1fr_300px]" : ""}`}>
        <Panel flush className="min-w-0 self-start">
          {periods.length === 0 ? (
            <Empty title="No periods set up">Add months or your financial year to control when postings are allowed.</Empty>
          ) : (
            <Table>
              <thead><tr><Th>Period</Th><Th>From</Th><Th>To</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-medium">{p.name}</Td>
                    <Td>{date(p.start_date)}</Td>
                    <Td>{date(p.end_date)}</Td>
                    <Td><Badge tone={tone[p.status]}>{label(p.status)}</Badge></Td>
                    <Td className="text-right">
                      {canWrite && (
                        <div className="flex justify-end gap-1">
                          {NEXT[p.status].map((n) => (
                            <form key={n.to} action={setPeriodStatus}>
                              <input type="hidden" name="id" value={p.id} />
                              <input type="hidden" name="status" value={n.to} />
                              <SubmitButton size="sm" tone={n.to === "locked" ? "danger" : "secondary"} pendingText="…">{n.label}</SubmitButton>
                            </form>
                          ))}
                          {p.status === "open" && (
                            <form action={deletePeriod}>
                              <input type="hidden" name="id" value={p.id} />
                              <SubmitButton size="sm" tone="quiet" confirm={`Delete ${p.name}?`} pendingText="…">Delete</SubmitButton>
                            </form>
                          )}
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        {canWrite && (
          <Panel title="Add period" className="self-start">
            <form action={createPeriod} className="flex flex-col gap-3">
              <Field label="Name"><Input name="name" required placeholder="March 2027" /></Field>
              <Field label="From"><Input name="start_date" type="date" required /></Field>
              <Field label="To"><Input name="end_date" type="date" required /></Field>
              <div><SubmitButton size="sm">Add period</SubmitButton></div>
            </form>
          </Panel>
        )}
      </div>
    </>
  );
}
