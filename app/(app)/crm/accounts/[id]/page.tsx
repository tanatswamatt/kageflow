import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Dl, Empty, Field, Input, Notice, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { AccountFields } from "@/components/crm/account-fields";
import { ConsentFields } from "@/components/crm/consent-fields";
import { ActivityFeed } from "@/components/crm/activity-feed";
import { LogActivity } from "@/components/crm/log-activity";
import { getContext } from "@/lib/context";
import { Timeline } from "@/components/timeline";
import type { ObjectEvent } from "@/lib/ontology";
import { getMembers } from "@/lib/members";
import { date, label, moneyFor, personName } from "@/lib/format";
import { dealTone, docTone, kindTone } from "@/lib/badges";
import { DOC_LABEL, docStatusLabel } from "@/lib/sales";
import type { Activity, Contact, CrmAccount, Deal, SalesDoc, Stage } from "@/lib/types";
import { createContact, deleteAccount, updateAccount } from "../../actions";
import { linkDealer } from "../../../inventory/transfer-actions";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string; edit?: string; h?: string }> }) {
  const { id } = await params;
  const notice = await searchParams;
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);

  const { data } = await ctx.supabase.from("crm_accounts").select("*").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const account = data as CrmAccount;

  const [{ data: contacts }, { data: deals }, { data: stages }, { data: acts }, members, { data: salesDocs }] = await Promise.all([
    ctx.supabase.from("crm_contacts").select("*").eq("company_id", ctx.companyId).eq("account_id", id).order("first_name"),
    ctx.supabase.from("crm_deals").select("*").eq("company_id", ctx.companyId).eq("account_id", id).order("created_at", { ascending: false }),
    ctx.supabase.from("crm_pipeline_stages").select("id, name").eq("company_id", ctx.companyId),
    ctx.supabase.from("crm_activities").select("*").eq("company_id", ctx.companyId).eq("account_id", id).order("created_at", { ascending: false }).limit(100),
    getMembers(),
    ctx.supabase.from("sales_docs").select("id, doc_type, number, status, total, currency, amount_due, issue_date, due_date").eq("company_id", ctx.companyId).eq("account_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const { data: eventData } = await ctx.supabase.from("object_events").select("*").eq("company_id", ctx.companyId).eq("subject_type", "customer").eq("subject_id", id).order("at", { ascending: false }).limit(400);
  const docs = (salesDocs ?? []) as Pick<SalesDoc, "id" | "doc_type" | "number" | "status" | "total" | "currency" | "amount_due" | "issue_date" | "due_date">[];
  const owing = new Map<string, number>();
  for (const d of docs) if (d.doc_type === "invoice" && d.status === "issued" && Number(d.amount_due) > 0) owing.set(d.currency, (owing.get(d.currency) ?? 0) + Number(d.amount_due));
  const stageName = new Map(((stages ?? []) as Pick<Stage, "id" | "name">[]).map((s) => [s.id, s.name]));
  const canWrite = ctx.can("crm.write");
  const back = `/crm/accounts/${id}`;
  const { data: dealerData } = await ctx.supabase.rpc("linked_dealer", { p_account: id });
  const linkedDealer = dealerData as { name: string; code: string } | null;
  const editing = notice.edit === "1" && canWrite;

  return (
    <>
      <PageHeader
        title={account.name}
        description={[account.industry, [account.city, account.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || undefined}
        back={{ href: "/crm/accounts", label: "Accounts" }}
        actions={
          <>
            <Badge tone={kindTone[account.kind]}>{label(account.kind)}</Badge>
            {canWrite && !editing && <ButtonLink href={`${back}?edit=1`} size="sm">Edit</ButtonLink>}
            <ButtonLink href={`/crm/accounts/${id}/statement`} size="sm">Statement</ButtonLink>
            {ctx.can("sales.write") && <ButtonLink href={`/sales/new?type=quote&account=${id}`} size="sm">New quote</ButtonLink>}
            {canWrite && <ButtonLink href={`/crm/deals/new?account=${id}`} size="sm" tone="primary">New deal</ButtonLink>}
          </>
        }
      />
      <Notice params={notice} />

      {editing && (
        <Panel title="Edit account" className="mb-6">
          <form action={updateAccount} className="flex flex-col gap-6">
            <input type="hidden" name="id" value={account.id} />
            <AccountFields account={account} members={members} />
            <div className="flex gap-2">
              <SubmitButton>Save changes</SubmitButton>
              <ButtonLink href={back} tone="quiet">Cancel</ButtonLink>
            </div>
          </form>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Deals" flush>
            {(deals ?? []).length === 0 ? (
              <Empty title="No deals with this account" />
            ) : (
              <ul className="divide-y divide-line">
                {((deals ?? []) as Deal[]).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/crm/deals/${d.id}`} className="font-medium hover:underline">{d.name}</Link>
                      <div className="text-xs text-ink-faint">{d.expected_close ? `Close ${date(d.expected_close)}` : `Created ${date(d.created_at)}`}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-semibold tabular-nums">{money(d.value, d.currency)}</span>
                      <Badge tone={dealTone[d.status]}>{d.status === "open" ? stageName.get(d.stage_id) : label(d.status)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Quotes, orders and invoices" flush action={owing.size > 0 && <span className="text-[13px] font-medium text-ember-700">Owes {[...owing].map(([c, v]) => money(v, c)).join(" + ")}</span>}>
            {docs.length === 0 ? (
              <Empty title="No sales documents yet" />
            ) : (
              <ul className="divide-y divide-line">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/sales/doc/${d.id}`} className="font-medium hover:underline">{DOC_LABEL[d.doc_type].one} {d.number ?? "(draft)"}</Link>
                      <div className="text-xs text-ink-faint">{date(d.issue_date)}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="tabular-nums">{money(d.total, d.currency)}</span>
                      <Badge tone={docTone[d.status]}>{docStatusLabel({ ...d, total: d.total }).text}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Everything with this customer" action={<span className="text-xs text-ink-faint">Sales, money, finance, trade-ins, messages and bills</span>}>
            <Timeline events={(eventData ?? []) as ObjectEvent[]} basePath={`/crm/accounts/${id}`} active={notice.h} />
          </Panel>

          <Panel title="Calls, meetings and notes" flush>
            {canWrite && <LogActivity refs={{ account_id: account.id }} back={back} />}
            <ActivityFeed activities={(acts ?? []) as Activity[]} names={names} back={back} canWrite={canWrite} />
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Details">
            <Dl
              items={[
                ["Email", account.email],
                ["Phone", account.phone],
                ["Website", account.website],
                ["VAT number", account.vat_no],
                ["Billing address", account.billing_address ? <span key="b" className="whitespace-pre-line">{account.billing_address}</span> : null],
                ["Payment terms", account.payment_days != null ? `${account.payment_days} days` : `Default (${ctx.company.default_payment_days} days)`],
                ["Owner", account.owner_id ? names.get(account.owner_id) : "Unassigned"],
                ["Since", date(account.created_at)],
              ]}
            />
            {account.notes && <p className="mt-4 whitespace-pre-line border-t border-line pt-3 text-ink-soft">{account.notes}</p>}
          </Panel>

          <Panel title="On Kageflow">
            {linkedDealer ? (
              <p className="text-[13px] text-ink-soft">This is <strong>{linkedDealer.name}</strong> ({linkedDealer.code}). Cars you invoice to them go straight into their Kageflow stock.</p>
            ) : (
              <p className="text-[13px] text-ink-soft">If this customer is a dealership on Kageflow, add their dealer code. Cars you invoice to them then go straight into their stock with details and photos.</p>
            )}
            {canWrite && (
              <form action={linkDealer} className="mt-3 flex items-end gap-2">
                <input type="hidden" name="account_id" value={id} />
                <Field label="Dealer code"><Input name="code" defaultValue={linkedDealer?.code ?? ""} placeholder="KF-1A2B3C" autoCapitalize="characters" /></Field>
                <SubmitButton size="sm" tone="secondary">{linkedDealer ? "Update" : "Link"}</SubmitButton>
              </form>
            )}
          </Panel>

          <Panel title="Contacts" flush>
            {(contacts ?? []).length === 0 ? (
              <Empty title="No contacts yet" />
            ) : (
              <ul className="divide-y divide-line">
                {((contacts ?? []) as Contact[]).map((c) => (
                  <li key={c.id} className="px-5 py-3">
                    <Link href={`/crm/contacts/${c.id}`} className="font-medium hover:underline">{personName(c)}</Link>
                    <div className="text-[13px] text-ink-soft">{[c.job_title, c.email, c.phone].filter(Boolean).join(" · ")}</div>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <details className="border-t border-line">
                <summary className="cursor-pointer px-5 py-3 text-[13px] font-medium text-shadow-700">Add a contact</summary>
                <form action={createContact} className="grid gap-3 px-5 pb-5">
                  <input type="hidden" name="account_id" value={account.id} />
                  <input type="hidden" name="back" value={back} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="First name"><Input name="first_name" /></Field>
                    <Field label="Last name"><Input name="last_name" /></Field>
                  </div>
                  <Field label="Job title"><Input name="job_title" /></Field>
                  <Field label="Email"><Input name="email" type="email" /></Field>
                  <Field label="Phone"><Input name="phone" type="tel" /></Field>
                  <ConsentFields law={ctx.rules.privacyLawShort} />
                  <div><SubmitButton size="sm">Add contact</SubmitButton></div>
                </form>
              </details>
            )}
          </Panel>

          {ctx.can("crm.delete") && (
            <Panel title="Delete">
              <p className="mb-3 text-ink-soft">Deletes the account and its deals. Contacts stay, unlinked.</p>
              <form action={deleteAccount}>
                <input type="hidden" name="id" value={account.id} />
                <SubmitButton tone="danger" size="sm" confirm="Delete this account and all its deals?">Delete account</SubmitButton>
              </form>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
