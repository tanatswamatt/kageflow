import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Field, Input, Notice, PageHeader, Panel, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { LeadFields } from "@/components/crm/lead-fields";
import { ActivityFeed } from "@/components/crm/activity-feed";
import { LogActivity } from "@/components/crm/log-activity";
import { getContext } from "@/lib/context";
import { getMembers } from "@/lib/members";
import { date, label, personName } from "@/lib/format";
import { leadTone } from "@/lib/badges";
import type { Activity, Lead } from "@/lib/types";
import { convertLead, deleteLead, updateLead } from "../../actions";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const notice = await searchParams;
  const ctx = await getContext();

  const { data } = await ctx.supabase.from("crm_leads").select("*").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const lead = data as Lead;

  const [{ data: acts }, { data: accounts }, members] = await Promise.all([
    ctx.supabase.from("crm_activities").select("*").eq("company_id", ctx.companyId).eq("lead_id", id).order("created_at", { ascending: false }),
    ctx.supabase.from("crm_accounts").select("id, name").eq("company_id", ctx.companyId).order("name").limit(500),
    getMembers(),
  ]);
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const canWrite = ctx.can("crm.write");
  const converted = lead.status === "converted";
  const title = personName(lead) || lead.company_name || "Lead";
  const back = `/crm/leads/${id}`;

  return (
    <>
      <PageHeader
        title={title}
        description={lead.company_name && personName(lead) ? lead.company_name : undefined}
        back={{ href: "/crm/leads", label: "Leads" }}
        actions={<Badge tone={leadTone[lead.status]}>{label(lead.status)}</Badge>}
      />
      <Notice params={notice} />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Details">
            <form action={updateLead} className="flex flex-col gap-6">
              <input type="hidden" name="id" value={lead.id} />
              <fieldset disabled={!canWrite || converted} className="contents">
                <LeadFields lead={lead} members={members} currency={ctx.company.base_currency} />
                {!converted && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Status">
                      <Select name="status" defaultValue={lead.status}>
                        {(["new", "contacted", "qualified", "disqualified"] as const).map((s) => (
                          <option key={s} value={s}>{label(s)}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Disqualified because" hint="Required when disqualifying">
                      <Input name="disqualified_reason" defaultValue={lead.disqualified_reason ?? ""} />
                    </Field>
                  </div>
                )}
                {canWrite && !converted && <div><SubmitButton>Save changes</SubmitButton></div>}
              </fieldset>
            </form>
          </Panel>

          <Panel title="Activity" flush>
            {canWrite && !converted && <LogActivity refs={{ lead_id: lead.id }} back={back} />}
            <ActivityFeed activities={(acts ?? []) as Activity[]} names={names} back={back} canWrite={canWrite} />
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          {converted ? (
            <Panel title="Converted">
              <p className="text-ink-soft">Converted on {date(lead.converted_at)}.</p>
              <div className="mt-3 flex flex-col gap-1.5">
                {lead.converted_account_id && <Link className="text-shadow-700 hover:underline" href={`/crm/accounts/${lead.converted_account_id}`}>Open account</Link>}
                {lead.converted_deal_id && <Link className="text-shadow-700 hover:underline" href={`/crm/deals/${lead.converted_deal_id}`}>Open deal</Link>}
              </div>
            </Panel>
          ) : canWrite && lead.status !== "disqualified" ? (
            <Panel title="Convert lead">
              <p className="mb-4 text-ink-soft">Creates a contact, links or creates the account, and opens a deal in the first pipeline stage.</p>
              <form action={convertLead} className="flex flex-col gap-4">
                <input type="hidden" name="id" value={lead.id} />
                <Field label="Account">
                  <Select name="account_id" defaultValue="">
                    <option value="">Create new: {lead.company_name || personName(lead)}</option>
                    {(accounts ?? []).map((a: { id: string; name: string }) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </Select>
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="create_deal" defaultChecked className="size-4 accent-jade-700" />
                  Open a deal
                </label>
                <Field label="Deal name" hint="Defaults to interest and company">
                  <Input name="deal_name" />
                </Field>
                <Field label={`Deal value (${lead.currency})`}>
                  <Input name="deal_value" inputMode="decimal" defaultValue={lead.estimated_value ?? ""} />
                </Field>
                <SubmitButton pendingText="Converting…">Convert</SubmitButton>
              </form>
            </Panel>
          ) : null}

          {ctx.can("crm.delete") && !converted && (
            <Panel title="Delete">
              <p className="mb-3 text-ink-soft">Removes the lead. Activities logged against it are kept, unlinked.</p>
              <form action={deleteLead}>
                <input type="hidden" name="id" value={lead.id} />
                <SubmitButton tone="danger" size="sm" confirm="Delete this lead?">Delete lead</SubmitButton>
              </form>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
