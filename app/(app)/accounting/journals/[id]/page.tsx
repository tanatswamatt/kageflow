import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Dl, Field, Input, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { memberNames } from "@/lib/members";
import { amount, date, dateTime, label, money, today } from "@/lib/format";
import type { Journal, JournalLine, LedgerAccount } from "@/lib/types";
import { deleteJournal, postJournal, reverseJournal } from "../../actions";

export const metadata: Metadata = { title: "Journal" };

type Line = JournalLine & { accounts: Pick<LedgerAccount, "id" | "code" | "name"> | null };

export default async function JournalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const notice = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("journals").select("*").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const j = data as Journal & { posted_by: string | null; created_by: string | null };

  const [{ data: lineData }, names] = await Promise.all([
    ctx.supabase.from("journal_lines").select("*, accounts(id, code, name)").eq("journal_id", id).order("line_no"),
    memberNames(),
  ]);
  const lines = (lineData ?? []) as Line[];
  const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
  const credit = lines.reduce((s, l) => s + Number(l.credit), 0);
  const base = ctx.company.base_currency;
  const canWrite = ctx.can("ledger.write");
  const posted = j.status === "posted";

  return (
    <>
      <PageHeader
        title={j.number ?? "Draft journal"}
        description={j.description}
        back={{ href: "/accounting/journals", label: "Journals" }}
        actions={<Badge tone={posted ? "jade" : "amber"}>{label(j.status)}</Badge>}
      />
      <Notice params={notice} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Panel flush className="min-w-0 self-start">
          <Table>
            <thead>
              <tr><Th>#</Th><Th>Account</Th><Th>Description</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th></tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <Td className="text-ink-faint tabular-nums">{l.line_no}</Td>
                  <Td>{l.accounts && <Link className="hover:underline" href={`/accounting/accounts/${l.accounts.id}`}><span className="tabular-nums text-ink-soft">{l.accounts.code}</span> {l.accounts.name}</Link>}</Td>
                  <Td className="text-ink-soft">{l.description}</Td>
                  <Td className="num">{amount(l.debit)}</Td>
                  <Td className="num">{amount(l.credit)}</Td>
                </tr>
              ))}
              <tr className="font-semibold">
                <Td colSpan={3} className="text-right text-ink-soft">Totals ({base})</Td>
                <Td className="num">{amount(debit)}</Td>
                <Td className="num">{amount(credit)}</Td>
              </tr>
            </tbody>
          </Table>
          {!posted && debit !== credit && (
            <p className="border-t border-line px-4 py-3 text-ember-700">Out of balance by {money(Math.abs(debit - credit), base)}. Delete this draft and re-enter it.</p>
          )}
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Details">
            <Dl
              items={[
                ["Date", date(j.journal_date)],
                ["Source", label(j.source_type)],
                ["Currency", j.currency === base ? base : `${j.currency} at ${j.fx_rate}`],
                ["Created by", j.created_by ? names.get(j.created_by) : ""],
                ["Posted", posted ? `${dateTime(j.posted_at)}${j.posted_by ? `, ${names.get(j.posted_by) ?? ""}` : ""}` : "Not yet"],
                ...(j.reversal_of ? ([["Reverses", <Link key="r" className="text-shadow-700 hover:underline" href={`/accounting/journals/${j.reversal_of}`}>Original journal</Link>]] as [string, React.ReactNode][]) : []),
                ...(j.reversed_by ? ([["Reversed by", <Link key="rb" className="text-shadow-700 hover:underline" href={`/accounting/journals/${j.reversed_by}`}>Reversal journal</Link>]] as [string, React.ReactNode][]) : []),
              ]}
            />
          </Panel>

          {canWrite && !posted && (
            <Panel title="Post or discard">
              <p className="mb-4 text-ink-soft">Posting locks the journal and numbers it. It can then only be corrected by a reversal.</p>
              <div className="flex gap-2">
                <form action={postJournal}>
                  <input type="hidden" name="id" value={j.id} />
                  <SubmitButton pendingText="Posting…" confirm="Post this journal? It can't be edited afterwards.">Post</SubmitButton>
                </form>
                <form action={deleteJournal}>
                  <input type="hidden" name="id" value={j.id} />
                  <SubmitButton tone="danger" confirm="Delete this draft?">Delete draft</SubmitButton>
                </form>
              </div>
            </Panel>
          )}

          {canWrite && posted && !j.reversed_by && !j.reversal_of && (
            <Panel title="Reverse">
              <p className="mb-4 text-ink-soft">Posts a mirror journal that cancels this one. Both stay in the ledger.</p>
              <form action={reverseJournal} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={j.id} />
                <Field label="Reversal date"><Input name="reversal_date" type="date" defaultValue={today()} required /></Field>
                <Field label="Reason"><Input name="reason" placeholder="Posted to the wrong account" /></Field>
                <div><SubmitButton tone="danger" pendingText="Reversing…" confirm="Post a reversal of this journal?">Reverse journal</SubmitButton></div>
              </form>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
