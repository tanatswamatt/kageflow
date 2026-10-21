import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Notice, PageHeader } from "@/components/ui";
import { StageMove } from "@/components/crm/stage-move";
import { getContext } from "@/lib/context";
import { memberNames } from "@/lib/members";
import { date, money } from "@/lib/format";
import type { Deal, Stage } from "@/lib/types";

export const metadata: Metadata = { title: "Deals" };

type DealRow = Deal & { crm_accounts: { name: string } | null };

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ closed?: string; error?: string; ok?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const showClosed = params.closed === "1";
  const base = ctx.company.base_currency;

  const [{ data: stageData }, { data: dealData }, names] = await Promise.all([
    ctx.supabase.from("crm_pipeline_stages").select("*").eq("company_id", ctx.companyId).order("position"),
    ctx.supabase
      .from("crm_deals")
      .select("*, crm_accounts(name)")
      .eq("company_id", ctx.companyId)
      .order("expected_close", { ascending: true, nullsFirst: false })
      .limit(500),
    memberNames(),
  ]);
  const stages = (stageData ?? []) as Stage[];
  const deals = (dealData ?? []) as DealRow[];
  const columns = stages.filter((s) => showClosed || (!s.is_won && !s.is_lost));
  const open = deals.filter((d) => d.status === "open" && d.currency === base);
  const pipelineValue = open.reduce((sum, d) => sum + Number(d.value), 0);
  const weighted = open.reduce((sum, d) => sum + Number(d.value) * ((stages.find((s) => s.id === d.stage_id)?.probability ?? 0) / 100), 0);
  const canWrite = ctx.can("crm.write");
  const back = `/crm/deals${showClosed ? "?closed=1" : ""}`;

  return (
    <>
      <PageHeader
        title="Deals"
        description={
          <>
            Open pipeline <strong className="font-semibold text-ink">{money(pipelineValue, base)}</strong>, weighted{" "}
            <strong className="font-semibold text-ink">{money(weighted, base)}</strong>
            {deals.some((d) => d.status === "open" && d.currency !== base) && <span className="text-ink-faint"> (excludes deals in other currencies)</span>}
          </>
        }
        actions={
          <>
            <ButtonLink href={showClosed ? "/crm/deals" : "/crm/deals?closed=1"} tone="quiet">
              {showClosed ? "Hide won and lost" : "Show won and lost"}
            </ButtonLink>
            {canWrite && <ButtonLink href="/crm/deals/new" tone="primary">New deal</ButtonLink>}
          </>
        }
      />
      <Notice params={params} />
      <div className="-mx-5 overflow-x-auto px-5 pb-4 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
        <div className="flex min-w-max gap-4">
          {columns.map((stage) => {
            const inStage = deals.filter((d) => d.stage_id === stage.id);
            const total = inStage.filter((d) => d.currency === base).reduce((s, d) => s + Number(d.value), 0);
            return (
              <section key={stage.id} className="flex w-72 flex-col rounded-[var(--radius-panel)] bg-shadow-100/60" aria-label={stage.name}>
                <header className="flex items-baseline justify-between gap-2 px-3 pt-3 pb-2">
                  <h2 className="font-semibold">
                    {stage.name} <span className="font-normal text-ink-faint">{inStage.length}</span>
                  </h2>
                  <span className="text-[13px] text-ink-soft tabular-nums">{money(total, base)}</span>
                </header>
                <div className="flex flex-col gap-2 px-2 pb-3">
                  {inStage.length === 0 && <p className="px-2 py-4 text-center text-[13px] text-ink-faint">No deals</p>}
                  {inStage.map((d) => {
                    const late = d.status === "open" && d.expected_close && d.expected_close < new Date().toISOString().slice(0, 10);
                    return (
                      <article key={d.id} className="rounded-[var(--radius-control)] border border-line bg-surface p-3">
                        <Link href={`/crm/deals/${d.id}`} className="block font-medium leading-snug hover:underline">{d.name}</Link>
                        <div className="mt-0.5 truncate text-[13px] text-ink-soft">{d.crm_accounts?.name}</div>
                        <div className="mt-2 flex items-baseline justify-between gap-2 text-[13px]">
                          <span className="font-semibold tabular-nums">{money(d.value, d.currency)}</span>
                          {d.expected_close && <span className={late ? "text-ember-700" : "text-ink-faint"}>{date(d.expected_close)}</span>}
                        </div>
                        <div className="mt-1 text-xs text-ink-faint">{d.owner_id ? names.get(d.owner_id) : "Unassigned"}</div>
                        {canWrite && !stage.is_won && !stage.is_lost && (
                          <div className="mt-2 border-t border-line pt-2">
                            <StageMove dealId={d.id} stageId={d.stage_id} stages={stages.filter((s) => !s.is_lost)} back={back} compact />
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <p className="text-[13px] text-ink-faint">To mark a deal lost, open it and give a reason.</p>
    </>
  );
}
