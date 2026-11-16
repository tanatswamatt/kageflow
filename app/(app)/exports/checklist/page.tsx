import type { Metadata } from "next";
import { Badge, Button, ButtonLink, Field, Input, Notice, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { getContext } from "@/lib/context";
import type { ExportRuleset, ExportRulesetItem } from "@/lib/types";
import {
  createExportRulesetVersion, publishExportRuleset, updateExportRulesetItem, updateExportRulesetMetadata,
} from "../actions";

export const metadata: Metadata = { title: "Export checklist" };

type RuleSetRow = ExportRuleset & { export_ruleset_items: ExportRulesetItem[] | null };

export default async function ExportChecklistPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const canManage = ctx.can("company.manage");
  const { data } = await ctx.supabase
    .from("export_rulesets")
    .select("*, export_ruleset_items(*)")
    .eq("company_id", ctx.companyId)
    .order("version", { ascending: false });
  const rulesets = (data ?? []) as RuleSetRow[];
  const drafts = rulesets.filter((ruleset) => ruleset.status === "draft");
  const published = rulesets.find((ruleset) => ruleset.status === "published");

  return (
    <>
      <PageHeader
        title="Export checklist"
        description="Review the corridor source and requirements. Each case keeps the checklist version it was opened against."
        back={{ href: "/exports", label: "Export cases" }}
        actions={<ButtonLink href="/exports" tone="secondary">View cases</ButtonLink>}
      />
      <Notice params={sp} />

      <Panel title="How checklist editing works" className="mb-5">
        <p className="text-sm text-ink-soft">
          Start a draft from the published version, update its source and requirements, then publish it after your compliance owner reviews it.
          The six rule handlers are deterministic and fixed in the application. In this screen you can change their wording, whether each one blocks readiness,
          and the required document groups. Changes apply to new cases only.
        </p>
      </Panel>

      {canManage && published && (
        <Panel title="Create a draft version" className="mb-5">
          <p className="mb-3 text-sm text-ink-soft">This copies version {published.version} into a new draft. It does not affect open cases or the currently published checklist.</p>
          <form action={createExportRulesetVersion}>
            <Button type="submit" tone="primary">Create draft from v{published.version}</Button>
          </form>
        </Panel>
      )}

      {rulesets.length === 0 && <Panel><p className="text-sm text-ink-soft">No export checklist is configured for this company.</p></Panel>}

      <div className="space-y-5">
        {rulesets.map((ruleset) => {
          const editable = canManage && ruleset.status === "draft";
          const items = [...(ruleset.export_ruleset_items ?? [])].sort((a, b) => a.position - b.position);
          return (
            <Panel key={ruleset.id} title={`${ruleset.title} · v${ruleset.version}`} action={
              <Badge tone={ruleset.status === "published" ? "jade" : ruleset.status === "draft" ? "amber" : "neutral"}>{ruleset.status}</Badge>
            }>
              {editable ? (
                <>
                  <form action={updateExportRulesetMetadata} className="grid gap-3 md:grid-cols-2">
                    <input type="hidden" name="ruleset_id" value={ruleset.id} />
                    <Field label="Checklist title"><Input name="title" required defaultValue={ruleset.title} /></Field>
                    <Field label="Source title"><Input name="source_title" required defaultValue={ruleset.source_title} /></Field>
                    <Field label="Source URL" hint="Use an HTTPS link to the official or approved source."><Input name="source_url" type="url" defaultValue={ruleset.source_url ?? ""} /></Field>
                    <Field label="Compliance notes"><Textarea name="notes" defaultValue={ruleset.notes ?? ""} /></Field>
                    <div className="md:col-span-2"><Button type="submit">Save checklist details</Button></div>
                  </form>
                  <div className="my-5 border-t border-line" />
                </>
              ) : (
                <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-ink-faint">Source</dt><dd>{ruleset.source_title}</dd></div>
                  <div><dt className="text-ink-faint">Effective from</dt><dd>{ruleset.effective_from}</dd></div>
                  {ruleset.source_url && <div><dt className="text-ink-faint">Source link</dt><dd><a className="text-shadow-700 underline" href={ruleset.source_url} target="_blank" rel="noreferrer">Open source</a></dd></div>}
                  {ruleset.notes && <div><dt className="text-ink-faint">Notes</dt><dd>{ruleset.notes}</dd></div>}
                </dl>
              )}

              <div className="space-y-4">
                {items.map((item) => {
                  const groups = Array.isArray(item.params?.document_groups) ? item.params.document_groups : null;
                  return editable ? (
                    <form key={item.id} action={updateExportRulesetItem} className="rounded-lg border border-line p-4">
                      <input type="hidden" name="item_id" value={item.id} />
                      <div className="mb-3 flex flex-wrap items-center gap-2"><Badge>{item.code}</Badge><span className="text-xs text-ink-faint">{item.category.replaceAll("_", " ")}</span></div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Requirement title"><Input name="title" required defaultValue={item.title} /></Field>
                        <Field label="Evidence hint"><Input name="evidence_hint" defaultValue={item.evidence_hint ?? ""} /></Field>
                        <Field label="Description"><Textarea name="description" defaultValue={item.description ?? ""} /></Field>
                        <Field label="Blocking behavior"><Select name="blocking" defaultValue={String(item.blocking)}><option value="true">Blocks readiness</option><option value="false">Advisory only</option></Select></Field>
                        {item.code === "customs_documents" && (
                          <Field label="Required document groups" hint="JSON array of groups. Each inner group means one accepted document from that group is required.">
                            <Textarea name="document_groups" className="min-h-36 font-mono text-xs" defaultValue={JSON.stringify(groups ?? [], null, 2)} required />
                          </Field>
                        )}
                      </div>
                      <div className="mt-3"><Button type="submit">Save requirement</Button></div>
                    </form>
                  ) : (
                    <div key={item.id} className="rounded-lg border border-line p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2"><Badge>{item.code}</Badge><Badge tone={item.blocking ? "ember" : "amber"}>{item.blocking ? "Blocking" : "Advisory"}</Badge></div>
                      <h3 className="font-medium">{item.title}</h3>
                      {item.description && <p className="mt-1 text-sm text-ink-soft">{item.description}</p>}
                      {item.evidence_hint && <p className="mt-1 text-xs text-ink-faint">Evidence: {item.evidence_hint}</p>}
                      {groups && <pre className="mt-2 overflow-x-auto rounded bg-paper p-2 text-xs">{JSON.stringify(groups, null, 2)}</pre>}
                    </div>
                  );
                })}
              </div>

              {editable && (
                <form action={publishExportRuleset} className="mt-5 border-t border-line pt-4">
                  <input type="hidden" name="ruleset_id" value={ruleset.id} />
                  <p className="mb-3 text-sm text-ink-soft">Publishing retires the previous version and makes this checklist the default for new export cases.</p>
                  <Button type="submit" tone="primary">Publish v{ruleset.version}</Button>
                </form>
              )}
              {!editable && items.length === 0 && <p className="text-sm text-ink-soft">No checklist items found.</p>}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
