import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Empty, PageHeader, Panel, Stat } from "@/components/ui";
import { getContext } from "@/lib/context";
import { dateTime, label, money, personName } from "@/lib/format";
import { leadTone } from "@/lib/badges";
import { SOURCE_LABEL } from "@/lib/types";
import type { Activity, Deal, Lead, Stage } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await getContext();
  const base = ctx.company.base_currency;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [{ data: stageData }, { data: openDeals }, { data: wonDeals }, { data: leadData }, { count: newLeads }, { data: tasks }, { data: drafts }] = await Promise.all([
    ctx.supabase.from("crm_pipeline_stages").select("*").eq("company_id", ctx.companyId).order("position"),
    ctx.supabase.from("crm_deals").select("id, stage_id, value, currency").eq("company_id", ctx.companyId).eq("status", "open"),
    ctx.supabase.from("crm_deals").select("value, currency").eq("company_id", ctx.companyId).eq("status", "won").gte("closed_at", monthStart),
    ctx.supabase.from("crm_leads").select("*").eq("company_id", ctx.companyId).in("status", ["new", "contacted", "qualified"]).order("created_at", { ascending: false }).limit(6),
    ctx.supabase.from("crm_leads").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).gte("created_at", weekAgo),
    ctx.supabase.from("crm_activities").select("*").eq("company_id", ctx.companyId).eq("owner_id", ctx.user.id).eq("type", "task").is("completed_at", null).order("due_at", { ascending: true, nullsFirst: false }).limit(6),
    ctx.supabase.from("journals").select("id", { count: "exact" }).eq("company_id", ctx.companyId).eq("status", "draft"),
  ]);
  const { data: unpaid } = await ctx.supabase.from("sales_docs").select("amount_due, currency, fx_rate, due_date").eq("company_id", ctx.companyId).eq("doc_type", "invoice").eq("status", "issued").gt("amount_due", 0);
  const todayStr = new Date().toISOString().slice(0, 10);
  const owed = ((unpaid ?? []) as { amount_due: number; currency: string; fx_rate: number; due_date: string | null }[]);
  const owedBase = owed.reduce((s, i) => s + Number(i.amount_due) * Number(i.fx_rate), 0);
  const overdueBase = owed.filter((i) => i.due_date && i.due_date < todayStr).reduce((s, i) => s + Number(i.amount_due) * Number(i.fx_rate), 0);

  const stages = ((stageData ?? []) as Stage[]).filter((s) => !s.is_won && !s.is_lost);
  const deals = ((openDeals ?? []) as Pick<Deal, "id" | "stage_id" | "value" | "currency">[]).filter((d) => d.currency === base);
  const pipeline = deals.reduce((s, d) => s + Number(d.value), 0);
  const won = ((wonDeals ?? []) as Pick<Deal, "value" | "currency">[]).filter((d) => d.currency === base).reduce((s, d) => s + Number(d.value), 0);
  const byStage = stages.map((s) => ({ stage: s, value: deals.filter((d) => d.stage_id === s.id).reduce((t, d) => t + Number(d.value), 0), count: deals.filter((d) => d.stage_id === s.id).length }));
  const maxStage = Math.max(1, ...byStage.map((b) => b.value));
  const now = Date.now();
  const showProfit = ctx.can("ledger.write");
  const { data: lotData } = showProfit
    ? await ctx.supabase.from("vehicle_profit").select("status, sold_on, days_in_stock, landed_cost, gross_profit, addon_profit, finance_income, commission").eq("company_id", ctx.companyId).or(`status.in.(in_stock,reserved),sold_on.gte.${monthStart.slice(0, 10)}`)
    : { data: [] };
  const lot = (lotData ?? []) as { status: string; sold_on: string | null; days_in_stock: number; landed_cost: number; gross_profit: number | null; addon_profit: number | null; finance_income: number; commission: number | null }[];
  const soldMonth = lot.filter((v) => v.status === "sold");
  const inStock = lot.filter((v) => v.status !== "sold");
  const netMonth = soldMonth.reduce((s, v) => s + Number(v.gross_profit ?? 0) + Number(v.addon_profit ?? 0) + Number(v.finance_income ?? 0) - Number(v.commission ?? 0), 0);
  const aged = inStock.filter((v) => v.days_in_stock > 90).length;

  return (
    <>
      <PageHeader
        title={`${ctx.company.name}`}
        description="Where sales and the books stand today."
        actions={ctx.can("sales.write") && (
          <>
            <ButtonLink href="/sales/new?type=quote">New quote</ButtonLink>
            <ButtonLink href="/sales/new?type=invoice" tone="primary">New invoice</ButtonLink>
          </>
        )}
      />
      {showProfit && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Cars sold this month" value={String(soldMonth.length)} />
          <Stat label="Net profit on cars this month" value={<Link className="hover:underline" href="/reports/profit-per-car">{money(netMonth, base)}</Link>} sub={soldMonth.length ? `${money(netMonth / soldMonth.length, base)} a car` : undefined} />
          <Stat label="Cars in stock" value={String(inStock.length)} sub={`${money(inStock.reduce((s, v) => s + Number(v.landed_cost), 0), base)} at cost`} />
          <Stat label="In stock over 90 days" value={<Link className={aged ? "text-amber-700 hover:underline" : "hover:underline"} href="/reports/profit-per-car?tab=stock">{aged}</Link>} />
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open pipeline" value={money(pipeline, base)} sub={`${deals.length} open deals`} />
        <Stat label="Won this month" value={money(won, base)} />
        <Stat label="New leads, last 7 days" value={newLeads ?? 0} />
        <Stat
          label="Customers owe"
          value={money(owedBase, base)}
          sub={overdueBase > 0 ? <Link className="font-medium text-ember-700 hover:underline" href="/sales/invoices?f=overdue">{money(overdueBase, base)} overdue</Link> : <Link className="text-shadow-700 hover:underline" href="/sales/receivables">Nothing overdue</Link>}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Pipeline by stage" action={<Link className="text-[13px] text-shadow-700 hover:underline" href="/crm/deals">Open board</Link>}>
          {deals.length === 0 ? (
            <Empty title="No open deals">Convert a qualified lead to start your pipeline.</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {byStage.map(({ stage, value, count }) => (
                <li key={stage.id} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate text-ink-soft">{stage.name}</span>
                  <span className="h-2.5 rounded-full bg-shadow-100" aria-hidden="true">
                    <span className="block h-full rounded-full bg-shadow-700" style={{ width: `${Math.max(value ? 3 : 0, (value / maxStage) * 100)}%` }} />
                  </span>
                  <span className="w-36 text-right tabular-nums">
                    {money(value, base)} <span className="text-ink-faint">({count})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="My follow-ups" action={<Link className="text-[13px] text-shadow-700 hover:underline" href="/crm/activities">All activities</Link>} flush>
          {(tasks ?? []).length === 0 ? (
            <Empty title="No open tasks" />
          ) : (
            <ul className="divide-y divide-line">
              {((tasks ?? []) as Activity[]).map((t) => {
                const overdue = t.due_at && new Date(t.due_at).getTime() < now;
                const href = t.deal_id ? `/crm/deals/${t.deal_id}` : t.lead_id ? `/crm/leads/${t.lead_id}` : t.account_id ? `/crm/accounts/${t.account_id}` : "/crm/activities";
                return (
                  <li key={t.id} className="px-5 py-3">
                    <Link href={href} className="font-medium hover:underline">{t.subject}</Link>
                    <div className={`text-xs ${overdue ? "font-medium text-ember-700" : "text-ink-faint"}`}>{t.due_at ? `Due ${dateTime(t.due_at)}` : "No due date"}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Latest open leads" action={<Link className="text-[13px] text-shadow-700 hover:underline" href="/crm/leads">All leads</Link>} flush className="lg:col-span-2">
          {(leadData ?? []).length === 0 ? (
            <Empty title="No open leads" />
          ) : (
            <ul className="divide-y divide-line">
              {((leadData ?? []) as Lead[]).map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/crm/leads/${l.id}`} className="font-medium hover:underline">{personName(l) || l.company_name}</Link>
                    <div className="truncate text-[13px] text-ink-soft">{l.interest || l.company_name}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-[13px] text-ink-faint">{SOURCE_LABEL[l.source] ?? label(l.source)}</span>
                    <Badge tone={leadTone[l.status]}>{label(l.status)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
