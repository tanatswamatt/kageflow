import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Empty, Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConsentFields } from "@/components/crm/consent-fields";
import { getContext } from "@/lib/context";
import { label, personName } from "@/lib/format";
import type { Contact } from "@/lib/types";
import { createContact } from "../actions";

export const metadata: Metadata = { title: "Contacts" };

type Row = Contact & { crm_accounts: { id: string; name: string } | null };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; error?: string; ok?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const q = params.q?.trim();
  let query = ctx.supabase.from("crm_contacts").select("*, crm_accounts(id, name)").eq("company_id", ctx.companyId).order("first_name").limit(300);
  if (q) {
    const term = `*${q.replace(/[*%,()]/g, " ")}*`;
    query = query.or(`first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
  }
  const [{ data }, { data: accounts }] = await Promise.all([
    query,
    ctx.supabase.from("crm_accounts").select("id, name").eq("company_id", ctx.companyId).order("name").limit(1000),
  ]);
  const contacts = (data ?? []) as Row[];
  const canWrite = ctx.can("crm.write");

  return (
    <>
      <PageHeader title="Contacts" description={`People at your accounts, with the ${ctx.rules.privacyLawShort === "POPIA" ? "POPIA" : "data protection"} basis for holding their details.`} />
      <Notice params={params} />
      <div className={`grid gap-6 ${canWrite ? "lg:grid-cols-[1fr_320px]" : ""}`}>
        <div className="min-w-0">
          <form className="mb-4 w-full sm:w-72">
            <Input name="q" type="search" defaultValue={q} placeholder="Search name, email, phone" aria-label="Search contacts" />
          </form>
          <Panel flush>
            {contacts.length === 0 ? (
              <Empty title={q ? "No contacts match that search" : "No contacts yet"} />
            ) : (
              <Table>
                <thead>
                  <tr><Th>Name</Th><Th>Account</Th><Th>Email</Th><Th>Phone</Th><Th>{ctx.rules.privacyLawShort} basis</Th></tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id} className="hover:bg-paper">
                      <Td>
                        <Link href={`/crm/contacts/${c.id}`} className="font-medium hover:underline">{personName(c)}</Link>
                        {c.job_title && <div className="text-xs text-ink-faint">{c.job_title}</div>}
                      </Td>
                      <Td>{c.crm_accounts && <Link href={`/crm/accounts/${c.crm_accounts.id}`} className="hover:underline">{c.crm_accounts.name}</Link>}</Td>
                      <Td className="text-ink-soft">{c.email}</Td>
                      <Td className="text-ink-soft">{c.phone}</Td>
                      <Td>
                        <Badge tone={c.consent_basis === "not_recorded" ? "amber" : "neutral"}>{label(c.consent_basis)}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>
        {canWrite && (
          <Panel title="Add contact" className="self-start">
            <form action={createContact} className="grid gap-3">
              <input type="hidden" name="back" value="/crm/contacts" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name"><Input name="first_name" /></Field>
                <Field label="Last name"><Input name="last_name" /></Field>
              </div>
              <Field label="Account">
                <Select name="account_id" defaultValue="">
                  <option value="">None</option>
                  {((accounts ?? []) as { id: string; name: string }[]).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
              <Field label="Job title"><Input name="job_title" /></Field>
              <Field label="Email"><Input name="email" type="email" /></Field>
              <Field label="Phone"><Input name="phone" type="tel" /></Field>
              <ConsentFields law={ctx.rules.privacyLawShort} />
              <div><SubmitButton size="sm">Add contact</SubmitButton></div>
            </form>
          </Panel>
        )}
      </div>
    </>
  );
}
