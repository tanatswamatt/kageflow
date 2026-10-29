import type { Metadata } from "next";
import { Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { getMembers } from "@/lib/members";
import { date, label } from "@/lib/format";
import { ROLES } from "@/lib/types";
import { cancelInvite, changeRole, inviteMember, removeMember, resendInvite } from "../actions";
import { savePlan } from "../../sales/commissions/actions";

export const metadata: Metadata = { title: "Team" };

const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including other owners and unlocking periods",
  admin: "Everything except managing owners",
  accountant: "Books, periods and the audit log. Reads the CRM.",
  sales: "Leads, deals, accounts and activities. Reads the books.",
  viewer: "Read only",
};

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const members = await getMembers();
  const canManage = ctx.can("company.manage");
  const { data: planData } = canManage ? await ctx.supabase.from("commission_plans").select("user_id, basis, rate, min_amount").eq("company_id", ctx.companyId) : { data: [] };
  const { data: inviteData } = canManage
    ? await ctx.supabase.from("company_invitations").select("id, email, role, created_at, expires_at").eq("company_id", ctx.companyId).is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false })
    : { data: [] };
  const invites = (inviteData ?? []) as { id: string; email: string; role: string; created_at: string; expires_at: string }[];
  const now = Date.now();
  const plans = new Map(((planData ?? []) as { user_id: string; basis: string; rate: number; min_amount: number }[]).map((p) => [p.user_id, p]));

  return (
    <>
      <PageHeader title="Team" description="Who can sign in to this company and what their role lets them do." />
      <Notice params={params} />
      <div className={`grid gap-6 ${canManage ? "lg:grid-cols-[1fr_320px]" : ""}`}>
        <Panel flush className="min-w-0 self-start">
          <Table>
            <thead><tr><Th>Name</Th><Th>Role</Th><Th>Joined</Th><Th /></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <Td>
                    <div className="font-medium">{m.name}{m.user_id === ctx.user.id && <span className="font-normal text-ink-faint"> (you)</span>}</div>
                    <div className="text-xs text-ink-faint">{m.email}</div>
                  </Td>
                  <Td>
                    {canManage ? (
                      <form action={changeRole} className="flex gap-1.5">
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <Select name="role" defaultValue={m.role} aria-label={`Role for ${m.name}`} className="h-8 w-36 text-[13px]">
                          {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                        </Select>
                        <SubmitButton size="sm" tone="secondary" pendingText="…">Set</SubmitButton>
                      </form>
                    ) : (
                      label(m.role)
                    )}
                  </Td>
                  <Td className="text-ink-soft">{date(m.created_at)}</Td>
                  <Td className="text-right">
                    {(canManage || m.user_id === ctx.user.id) && (
                      <form action={removeMember}>
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <SubmitButton size="sm" tone="quiet" confirm={m.user_id === ctx.user.id ? "Leave this company?" : `Remove ${m.name}?`} pendingText="…">
                          {m.user_id === ctx.user.id ? "Leave" : "Remove"}
                        </SubmitButton>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <dl className="grid gap-x-4 gap-y-1.5 border-t border-line px-4 py-4 text-[13px] sm:grid-cols-[100px_1fr]">
            {ROLES.map((r) => (
              <div key={r} className="contents">
                <dt className="font-medium">{label(r)}</dt>
                <dd className="text-ink-soft">{ROLE_HELP[r]}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        {canManage && (
          <div className="flex flex-col gap-6 self-start">
            <Panel title="Invite a team member">
              <p className="mb-4 text-[13px] text-ink-soft">We&apos;ll email them a link. They set a password and land straight in {ctx.company.name} with the role you choose.</p>
              <form action={inviteMember} className="flex flex-col gap-3">
                <Field label="Email"><Input name="email" type="email" required autoComplete="off" /></Field>
                <Field label="Role">
                  <Select name="role" defaultValue="sales">
                    {ROLES.filter((r) => r !== "owner" || ctx.role === "owner").map((r) => <option key={r} value={r}>{label(r)}</option>)}
                  </Select>
                </Field>
                <div><SubmitButton size="sm" pendingText="Sending…">Send invitation</SubmitButton></div>
              </form>
            </Panel>
            {invites.length > 0 && (
              <Panel title="Waiting to join" flush>
                <ul className="divide-y divide-line">
                  {invites.map((i) => {
                    const expired = new Date(i.expires_at).getTime() < now;
                    return (
                      <li key={i.id} className="flex flex-col gap-2 px-4 py-3 text-[13px]">
                        <div>
                          <div className="font-medium break-all">{i.email}</div>
                          <div className="text-ink-faint">{label(i.role)} · {expired ? <span className="text-amber-700">expired</span> : `sent ${date(i.created_at)}`}</div>
                        </div>
                        <div className="flex gap-2">
                          <form action={resendInvite}><input type="hidden" name="id" value={i.id} /><SubmitButton size="sm" tone="secondary" pendingText="Sending…">Send again</SubmitButton></form>
                          <form action={cancelInvite}><input type="hidden" name="id" value={i.id} /><SubmitButton size="sm" tone="quiet" confirm={`Cancel the invitation for ${i.email}?`} pendingText="…">Cancel</SubmitButton></form>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            )}
          </div>
        )}
      </div>
      {canManage && (
        <Panel title="Commission plans" className="mt-6" flush>
          <p className="px-5 pt-4 text-[13px] text-ink-soft">Commission is worked out when an invoice is issued, from the salesperson on that invoice. Gross profit is the selling price excluding VAT, less the car&apos;s landed cost.</p>
          <Table>
            <thead><tr><Th>Salesperson</Th><Th>Paid on</Th><Th>Rate</Th><Th>Minimum per car ({ctx.company.base_currency})</Th><Th /></tr></thead>
            <tbody>
              {members.map((m) => {
                const p = plans.get(m.user_id);
                const fid = `plan-${m.user_id}`;
                return (
                  <tr key={m.user_id}>
                    <Td className="font-medium">{m.name}</Td>
                    <Td>
                      <Select form={fid} name="basis" defaultValue={p?.basis ?? ""} className="h-8 text-[13px]" aria-label={`Commission basis for ${m.name}`}>
                        <option value="">No commission</option>
                        <option value="gross_profit_pct">% of gross profit</option>
                        <option value="sale_pct">% of selling price</option>
                        <option value="flat_per_car">Flat amount per car</option>
                      </Select>
                    </Td>
                    <Td><Input form={fid} name="rate" inputMode="decimal" defaultValue={p ? String(Number(p.rate)) : ""} placeholder="10" className="h-8 w-24 text-[13px]" aria-label="Rate" /></Td>
                    <Td><Input form={fid} name="min_amount" inputMode="decimal" defaultValue={p ? String(Number(p.min_amount)) : ""} placeholder="0" className="h-8 w-28 text-[13px]" aria-label="Minimum" /></Td>
                    <Td className="text-right">
                      <form id={fid} action={savePlan}><input type="hidden" name="user_id" value={m.user_id} /><SubmitButton size="sm" tone="secondary" pendingText="…">Save</SubmitButton></form>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
