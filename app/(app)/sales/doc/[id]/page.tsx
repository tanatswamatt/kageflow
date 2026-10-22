import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Dl, Field, Input, Notice, PageHeader, Panel, Table, Td, Textarea, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { CopyField } from "@/components/copy-field";
import { DocEditor } from "@/components/sales/doc-editor";
import { loadCatalog, loadCustomers, loadTaxes } from "@/lib/catalog";
import { getContext } from "@/lib/context";
import { FINANCE_LABEL } from "@/lib/finance";
import { amount, date, money } from "@/lib/format";
import { docTone } from "@/lib/badges";
import { DOC_LABEL, DOC_SLUG, docStatusLabel, docTitle } from "@/lib/sales";
import { CURRENCIES, type Allocation, type Payment, type SalesDoc, type SalesLine } from "@/lib/types";
import { convertDoc, deleteDraft, emailDoc, saveDocument, setDocStatus, setTrackingStage } from "../../actions";

export const metadata: Metadata = { title: "Sales document" };

type Doc = SalesDoc & { crm_accounts: { id: string; name: string; email: string | null; billing_address: string | null; vat_no: string | null } | null };

const STAGES = ["Awaiting deposit", "Vehicle prepared", "Documents in progress", "Awaiting collection", "In transit", "At the border", "Cleared customs", "Delivered"];

export default async function SalesDocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const notice = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("sales_docs").select("*, crm_accounts(id, name, email, billing_address, vat_no)").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const doc = data as Doc;
  const base = ctx.company.base_currency;
  const draft = doc.status === "draft";
  const canWrite = ctx.can("sales.write");
  const canPay = ctx.can("payments.write");

  const [{ data: lineData }, { data: related }, { data: source }, { data: allocs }, { data: deposits }] = await Promise.all([
    ctx.supabase.from("sales_doc_lines").select("*").eq("doc_id", id).order("line_no"),
    ctx.supabase.from("sales_docs").select("id, doc_type, number, status, total, currency").eq("company_id", ctx.companyId).eq("source_doc_id", id).order("created_at"),
    doc.source_doc_id ? ctx.supabase.from("sales_docs").select("id, doc_type, number").eq("id", doc.source_doc_id).maybeSingle() : Promise.resolve({ data: null }),
    doc.doc_type === "invoice" ? ctx.supabase.from("payment_allocations").select("*, customer_payments(id, number, payment_date)").eq("invoice_id", id).order("created_at") : Promise.resolve({ data: [] }),
    doc.doc_type === "order" ? ctx.supabase.from("customer_payments").select("*").eq("order_id", id).is("reversal_journal_id", null).order("payment_date") : Promise.resolve({ data: [] }),
  ]);
  const lines = (lineData ?? []) as SalesLine[];
  const [{ data: finApps }, { data: tradeIns }] = doc.doc_type === "order" && !draft
    ? await Promise.all([
        canWrite ? ctx.supabase.from("finance_applications").select("id, number, status").eq("order_id", id).order("created_at") : Promise.resolve({ data: [] }),
        ctx.supabase.from("trade_ins").select("id, number, status, allowance, make, model").eq("order_id", id).order("created_at"),
      ])
    : [{ data: [] }, { data: [] }];

  const editor = draft && canWrite
    ? await Promise.all([loadCustomers(ctx), loadCatalog(ctx, { creditFor: doc.doc_type === "credit_note" ? doc.source_doc_id : null }), loadTaxes(ctx)])
    : null;

  const label = DOC_LABEL[doc.doc_type];
  const st = docStatusLabel(doc);
  const foreign = doc.currency !== base;
  const back = `/sales/doc/${id}`;
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get("origin") ?? "";
  const shareUrl = `${origin}/d/${doc.share_token}`;
  const statusButton = (status: string, text: string, tone: "primary" | "secondary" | "danger" = "secondary", confirm?: string) => (
    <form action={setDocStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton size="sm" tone={tone} confirm={confirm} pendingText="…">{text}</SubmitButton>
    </form>
  );
  const convertButton = (to: string, text: string, tone: "primary" | "secondary" = "secondary") => (
    <form action={convertDoc}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to" value={to} />
      <SubmitButton size="sm" tone={tone} pendingText="Creating…">{text}</SubmitButton>
    </form>
  );

  return (
    <>
      <PageHeader
        title={docTitle(doc)}
        description={
          <>
            {label.one} for <Link className="font-medium text-ink hover:underline" href={`/crm/accounts/${doc.account_id}`}>{doc.crm_accounts?.name}</Link>
            {source && <> from <Link className="hover:underline" href={`/sales/doc/${(source as { id: string }).id}`}>{(source as { number: string | null }).number ?? "draft"}</Link></>}
          </>
        }
        back={{ href: `/sales/${DOC_SLUG[doc.doc_type]}`, label: label.many }}
        actions={
          <>
            <Badge tone={st.overdue ? "ember" : st.text === "Paid" ? "jade" : docTone[doc.status]}>{st.text}</Badge>
            <ButtonLink href={`/print/${id}`} size="sm" target="_blank">Print or save PDF</ButtonLink>
          </>
        }
      />
      <Notice params={notice} />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          {draft && canWrite && editor ? (
            <DocEditor
              doc={{
                id: doc.id,
                doc_type: doc.doc_type,
                account_id: doc.account_id,
                currency: doc.currency,
                fx_rate: Number(doc.fx_rate),
                issue_date: doc.issue_date,
                due_date: doc.due_date,
                valid_until: doc.valid_until,
                reference: doc.reference,
                notes: doc.notes,
                terms: doc.terms,
                credit_reason: doc.credit_reason,
                lines: lines.map((l) => ({ product_id: l.product_id, unit_id: l.unit_id, description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price), tax_rate_id: l.tax_rate_id })),
              }}
              customers={editor[0]}
              catalog={editor[1]}
              taxes={editor[2]}
              currencies={CURRENCIES}
              base={base}
              defaultDays={ctx.company.default_payment_days}
              lockCustomer={doc.doc_type === "credit_note" || !!doc.source_doc_id}
              action={saveDocument}
            />
          ) : (
            <Panel flush>
              <Table>
                <thead>
                  <tr><Th>#</Th><Th>Description</Th><Th className="text-right">Qty</Th><Th className="text-right">Price</Th><Th className="text-right">VAT %</Th><Th className="text-right">Amount ({doc.currency})</Th></tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <Td className="text-ink-faint tabular-nums">{l.line_no}</Td>
                      <Td className="whitespace-pre-line">{l.description}{Number(l.discount_pct) > 0 && <span className="text-ink-faint"> (less {Number(l.discount_pct)}%)</span>}</Td>
                      <Td className="num">{Number(l.quantity)}</Td>
                      <Td className="num">{amount(l.unit_price)}</Td>
                      <Td className="num">{Math.round(Number(l.tax_rate) * 1000) / 10}</Td>
                      <Td className="num">{amount(l.line_subtotal) || "0.00"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <dl className="ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 px-4 py-4 text-sm tabular-nums">
                <dt className="text-ink-soft">Subtotal</dt><dd className="text-right">{money(doc.subtotal, doc.currency)}</dd>
                <dt className="text-ink-soft">VAT</dt><dd className="text-right">{money(doc.tax_total, doc.currency)}</dd>
                <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{money(doc.total, doc.currency)}</dd>
                {foreign && (<><dt className="text-ink-faint">In {base} at {Number(doc.fx_rate)}</dt><dd className="text-right text-ink-faint">{money(Number(doc.total) * Number(doc.fx_rate), base)}</dd></>)}
                {doc.doc_type === "invoice" && doc.status === "issued" && (
                  <>
                    {Number(doc.amount_paid) > 0 && (<><dt className="text-ink-soft">Paid</dt><dd className="text-right">{money(-doc.amount_paid, doc.currency)}</dd></>)}
                    {Number(doc.amount_credited) > 0 && (<><dt className="text-ink-soft">Credited</dt><dd className="text-right">{money(-doc.amount_credited, doc.currency)}</dd></>)}
                    <dt className="font-semibold">Amount due</dt><dd className={`text-right font-semibold ${st.overdue ? "text-ember-700" : ""}`}>{money(doc.amount_due, doc.currency)}</dd>
                  </>
                )}
              </dl>
            </Panel>
          )}

          {doc.doc_type === "invoice" && (allocs ?? []).length > 0 && (
            <Panel title="Payments applied" flush>
              <Table>
                <thead><tr><Th>Payment</Th><Th>Date</Th><Th className="text-right">Amount ({doc.currency})</Th><Th className="text-right">FX difference ({base})</Th></tr></thead>
                <tbody>
                  {((allocs ?? []) as (Allocation & { customer_payments: { id: string; number: string; payment_date: string } })[]).map((a) => (
                    <tr key={a.id}>
                      <Td><Link className="hover:underline" href={`/sales/payments/${a.customer_payments.id}`}>{a.customer_payments.number}</Link></Td>
                      <Td>{date(a.customer_payments.payment_date)}</Td>
                      <Td className="num">{amount(a.amount)}</Td>
                      <Td className={`num ${Number(a.fx_difference) < 0 ? "text-ember-700" : ""}`}>{Number(a.fx_difference) ? `${Number(a.fx_difference) > 0 ? "gain " : "loss "}${amount(Math.abs(Number(a.fx_difference)))}` : ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}

          {doc.doc_type === "order" && (deposits ?? []).length > 0 && (
            <Panel title="Deposits received" flush>
              <ul className="divide-y divide-line">
                {((deposits ?? []) as Payment[]).map((p) => (
                  <li key={p.id} className="flex justify-between px-5 py-3">
                    <Link className="hover:underline" href={`/sales/payments/${p.id}`}>{p.number} on {date(p.payment_date)}</Link>
                    <span className="tabular-nums">{money(p.amount, p.currency)}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-5 py-3 text-[13px] text-ink-faint">Deposits are applied to the invoice automatically when it is issued.</p>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Summary">
            <Dl
              items={[
                ["Customer", doc.crm_accounts?.name],
                ["Date", date(doc.issue_date)],
                ...(doc.doc_type === "quote" ? ([["Valid until", date(doc.valid_until)]] as [string, string][]) : []),
                ...(doc.doc_type === "invoice" ? ([["Due", date(doc.due_date)]] as [string, string][]) : []),
                ["Currency", foreign ? `${doc.currency} at ${Number(doc.fx_rate)}` : doc.currency],
                ["Reference", doc.reference],
                ...(doc.doc_type === "order" ? ([["Tracking", doc.tracking_stage]] as [string, string | null][]) : []),
                ...(doc.credit_reason ? ([["Reason", doc.credit_reason]] as [string, string][]) : []),
                ...(doc.journal_id ? ([["Ledger", <Link key="j" className="text-shadow-700 hover:underline" href={`/accounting/journals/${doc.journal_id}`}>View journal</Link>]] as [string, React.ReactNode][]) : []),
              ]}
            />
          </Panel>

          {canWrite && (
            <Panel title="Next step">
              <div className="flex flex-wrap gap-2">
                {doc.doc_type === "quote" && doc.status === "draft" && convertButton("order", "Convert to order")}
                {doc.doc_type === "quote" && doc.status === "sent" && <>{convertButton("order", "Accept and create order", "primary")}{convertButton("invoice", "Accept and invoice")}{statusButton("declined", "Declined")}</>}
                {doc.doc_type === "quote" && doc.status === "accepted" && <>{convertButton("order", "Create order", "primary")}{convertButton("invoice", "Create invoice")}</>}
                {doc.doc_type === "order" && doc.status === "open" && (
                  <>
                    {convertButton("invoice", "Create invoice", "primary")}
                    {canPay && <ButtonLink size="sm" href={`/sales/payments/new?account=${doc.account_id}&order=${id}`}>Record deposit</ButtonLink>}
                    {statusButton("cancelled", "Cancel order", "danger", "Cancel this order? Reserved vehicles go back to stock.")}
                  </>
                )}
                {draft && <p className="w-full text-[13px] text-ink-soft">Finish the {label.one.toLowerCase()} on the left, then use the buttons at the bottom.</p>}
                {doc.doc_type === "invoice" && doc.status === "issued" && Number(doc.amount_due) > 0 && (
                  <>
                    {canPay && <ButtonLink size="sm" tone="primary" href={`/sales/payments/new?account=${doc.account_id}&invoice=${id}`}>Record payment</ButtonLink>}
                    {convertButton("credit_note", "Create credit note")}
                  </>
                )}
                {draft && (
                  <form action={deleteDraft}>
                    <input type="hidden" name="id" value={id} />
                    <SubmitButton size="sm" tone="quiet" confirm="Discard this draft?" pendingText="…">Discard draft</SubmitButton>
                  </form>
                )}
                {!draft && doc.doc_type === "invoice" && Number(doc.amount_due) <= 0 && <p className="text-ink-soft">Paid in full.</p>}
                {doc.doc_type === "order" && doc.status === "fulfilled" && <p className="text-ink-soft">Invoiced and fulfilled.</p>}
              </div>
              {doc.doc_type === "order" && doc.status === "draft" && <p className="mt-3 text-[13px] text-ink-faint">Confirming reserves the vehicles on this order.</p>}
            </Panel>
          )}

          {doc.doc_type === "order" && doc.status !== "draft" && canWrite && (
            <Panel title="Finance and trade-in">
              <ul className="mb-3 flex flex-col gap-1.5 text-sm">
                {((finApps ?? []) as { id: string; number: string | null; status: string }[]).map((f) => (
                  <li key={f.id}><Link className="text-shadow-700 hover:underline" href={`/sales/finance/${f.id}`}>{f.number}</Link> <span className="text-ink-faint">finance, {FINANCE_LABEL[f.status]?.toLowerCase()}</span></li>
                ))}
                {((tradeIns ?? []) as { id: string; number: string | null; status: string; allowance: number | null; make: string | null; model: string | null }[]).map((t) => (
                  <li key={t.id}><Link className="text-shadow-700 hover:underline" href={`/sales/trade-ins/${t.id}`}>{t.number}</Link> <span className="text-ink-faint">trade-in {[t.make, t.model].filter(Boolean).join(" ")}, {t.status === "draft" ? "offer" : t.status}</span></li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Link href={`/sales/finance/new?order=${id}`} className="text-[13px] font-medium text-shadow-700 hover:underline">+ Finance application</Link>
                <Link href={`/sales/trade-ins/new?order=${id}`} className="text-[13px] font-medium text-shadow-700 hover:underline">+ Trade-in</Link>
              </div>
            </Panel>
          )}

          {doc.doc_type === "order" && doc.status !== "draft" && canWrite && (
            <Panel title="Tracking stage">
              <form action={setTrackingStage} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={id} />
                <Input name="tracking_stage" list="stages" defaultValue={doc.tracking_stage ?? ""} placeholder="In transit" />
                <datalist id="stages">{STAGES.map((s) => <option key={s} value={s} />)}</datalist>
                <SubmitButton size="sm" tone="secondary">Update stage</SubmitButton>
              </form>
              <p className="mt-3 text-[13px] text-ink-faint">Customers see this on the order tracker. Changes are sent to your connected website.</p>
            </Panel>
          )}

          {(related ?? []).length > 0 && (
            <Panel title="Created from this">
              <ul className="flex flex-col gap-2">
                {((related ?? []) as Pick<SalesDoc, "id" | "doc_type" | "number" | "status" | "total" | "currency">[]).map((r) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <Link className="text-shadow-700 hover:underline" href={`/sales/doc/${r.id}`}>{DOC_LABEL[r.doc_type].one} {r.number ?? "(draft)"}</Link>
                    <span className="tabular-nums text-ink-soft">{money(r.total, r.currency)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {!draft && (
            <Panel title="Share">
              <p className="mb-2 text-[13px] text-ink-soft">Anyone with this link can view and print the document.</p>
              <CopyField value={shareUrl} />
              {canWrite && (
                <form action={emailDoc} className="mt-4 flex flex-col gap-2">
                  <input type="hidden" name="id" value={id} />
                  <Field label="Email to"><Input name="to" type="email" defaultValue={doc.crm_accounts?.email ?? ""} required /></Field>
                  <Field label="Message"><Textarea name="message" rows={2} placeholder={`Please find ${label.one.toLowerCase()} ${doc.number ?? ""} attached.`} /></Field>
                  <div><SubmitButton size="sm" tone="secondary" pendingText="Sending…">Send email</SubmitButton></div>
                </form>
              )}
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
