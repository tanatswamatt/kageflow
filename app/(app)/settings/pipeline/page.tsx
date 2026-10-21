import type { Metadata } from "next";
import { Badge, Field, Input, Notice, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import type { Stage } from "@/lib/types";
import { deleteStage, saveStage } from "../actions";

export const metadata: Metadata = { title: "Pipeline stages" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("crm_pipeline_stages").select("*").eq("company_id", ctx.companyId).order("position");
  const stages = (data ?? []) as Stage[];
  const canEdit = ctx.can("crm.stages");

  return (
    <>
      <PageHeader title="Pipeline stages" description="The steps a deal moves through. Probability weights the pipeline forecast. Won and lost stages close the deal." />
      <Notice params={params} />
      <Panel flush className="max-w-3xl">
        <ol className="divide-y divide-line">
          {stages.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-end gap-3 px-5 py-3">
              <span className="w-6 pb-2 text-ink-faint tabular-nums">{i + 1}</span>
              <form action={saveStage} className="flex flex-1 flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={s.id} />
                <Field label="Name" className="min-w-40 flex-1"><Input name="name" defaultValue={s.name} disabled={!canEdit} /></Field>
                <Field label="Probability %" className="w-28"><Input name="probability" type="number" min={0} max={100} defaultValue={s.probability} disabled={!canEdit} /></Field>
                <div className="pb-1.5">{s.is_won ? <Badge tone="jade">Won</Badge> : s.is_lost ? <Badge tone="ember">Lost</Badge> : <Badge tone="shadow">Open</Badge>}</div>
                {canEdit && <SubmitButton size="sm" tone="secondary" pendingText="…">Save</SubmitButton>}
              </form>
              {canEdit && !s.is_won && !s.is_lost && (
                <form action={deleteStage}>
                  <input type="hidden" name="id" value={s.id} />
                  <SubmitButton size="sm" tone="quiet" confirm={`Delete the ${s.name} stage?`} pendingText="…">Delete</SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ol>
        {canEdit && (
          <form action={saveStage} className="flex flex-wrap items-end gap-3 border-t border-line bg-paper px-5 py-4">
            <Field label="New open stage" className="min-w-40 flex-1"><Input name="name" required placeholder="Deposit paid" /></Field>
            <Field label="Probability %" className="w-28"><Input name="probability" type="number" min={0} max={100} defaultValue={50} /></Field>
            <SubmitButton size="sm">Add stage</SubmitButton>
          </form>
        )}
      </Panel>
    </>
  );
}
