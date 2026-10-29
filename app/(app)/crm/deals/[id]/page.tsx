import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Dl, Field, Input, Notice, PageHeader, Panel, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { OwnerSelect } from "@/components/crm/owner-select";
import { StageMove } from "@/components/crm/stage-move";
import { ActivityFeed } from "@/components/crm/activity-feed";
import { LogActivity } from "@/components/crm/log-activity";
import { getContext } from "@/lib/context";
import { CURRENCIES } from "@/lib/types";
import { getMembers } from "@/lib/members";
import { date, label, money, personName } from "@/lib/format";
import { dealTone } from "@/lib/badges";
import type { Activity, Deal, Stage } from "@/lib/types";
import { deleteDeal, updateDeal } from "../../actions";

export const metadata: Metadata = { title: "Deal" };

type DealRow = Deal & { crm_accounts: { id: string; name: string } | null };
type ContactOption = { id: string; first_name: string | null; last_name: string | null };

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const notice = await searchParams;
  const ctx = await getContext();

  const { data } = await ctx.supabase.from("crm_deals").select("*, crm_accounts(id, name)").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const deal = data as DealRow;

  const [{ data: stageData }, { data: contacts }, { data: acts }, members] = await Promise.all([
    ctx.supabase.from("crm_pipeline_stages").select("*").eq("company_id", ctx.companyId).order("position"),
    ctx.supabase.from("crm_contacts").select("id, first_name, last_name").eq("company_id", ctx.companyId).eq("account_id", deal.account_id).order("first_name"),
    ctx.supabase.from("crm_activities").select("*").eq("company_id", ctx.companyId).eq("deal_id", id).order("created_at", { ascending: false }),
    getMembers(),
  ]);
  const stages = (stageData ?? []) as Stage[];
  const stage = stages.find((s) => s.id === deal.stage_id);
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const canWrite = ctx.can("crm.write");
  const back = `/crm/deals/${id}`;

  return (
    <>
      <PageHeader
        title={deal.name}
        description={deal.crm_accounts && <Link className="hover:underline" href={`/crm/accounts/${deal.crm_accounts.id}`}>{deal.crm_accounts.name}</Link>}
        back={{ href: "/crm/deals", label: "Deals" }}
        actions={
          <>
            <Badge tone={dealTone[deal.status]}>{deal.status === "open" ? stage?.name : label(deal.status)}</Badge>
            {ctx.can("sales.write") && <ButtonLink size="sm" tone="primary" href={`/sales/new?type=quote&deal=${deal.id}`}>Create quote</ButtonLink>}
          </>
        }
      />
      <Notice params={notice} />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Activity" flush>
            {canWrite && <LogActivity refs={{ deal_id: deal.id, account_id: deal.account_id, contact_id: deal.contact_id }} back={back} />}
            <ActivityFeed activities={(acts ?? []) as Activity[]} names={names} back={back} canWrite={canWrite} />
          </Panel>

          {canWrite && (
            <Panel title="Edit deal">
              <form action={updateDeal} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="id" value={deal.id} />
                <Field label="Deal name" className="sm:col-span-2"><Input name="name" defaultValue={deal.name} required /></Field>
                <Field label="Value"><Input name="value" inputMode="decimal" defaultValue={deal.value} /></Field>
                <Field label="Currency">
                  <Select name="currency" defaultValue={deal.currency}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </Select>
                </Field>
                <Field label="Expected close"><Input name="expected_close" type="date" defaultValue={deal.expected_close ?? ""} /></Field>
                <Field label="Main contact">
                  <Select name="contact_id" defaultValue={deal.contact_id ?? ""}>
                    <option value="">None</option>
                    {((contacts ?? []) as ContactOption[]).map((c) => <option key={c.id} value={c.id}>{personName(c)}</option>)}
                  </Select>
                </Field>
                <OwnerSelect members={members} value={deal.owner_id} />
                <div className="sm:col-span-2"><SubmitButton>Save changes</SubmitButton></div>
              </form>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Summary">
            <Dl
              items={[
                ["Value", <span key="v" className="font-semibold tabular-nums">{money(deal.value, deal.currency)}</span>],
                ["Stage", stage?.name],
                ["Probability", stage ? `${stage.probability}%` : ""],
                ["Expected close", date(deal.expected_close)],
                ["Owner", deal.owner_id ? names.get(deal.owner_id) : "Unassigned"],
                ["Created", date(deal.created_at)],
                ...(deal.closed_at ? ([["Closed", date(deal.closed_at)]] as [string, string][]) : []),
                ...(deal.lost_reason ? ([["Lost because", deal.lost_reason]] as [string, string][]) : []),
              ]}
            />
          </Panel>
          {canWrite && (
            <Panel title="Move stage">
              <StageMove dealId={deal.id} stageId={deal.stage_id} stages={stages} back={back} />
            </Panel>
          )}
          {ctx.can("crm.delete") && (
            <Panel title="Delete">
              <form action={deleteDeal}>
                <input type="hidden" name="id" value={deal.id} />
                <SubmitButton tone="danger" size="sm" confirm="Delete this deal?">Delete deal</SubmitButton>
              </form>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
