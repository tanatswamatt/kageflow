import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Dl, Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { UnitFields } from "@/components/inventory/unit-fields";
import { getContext } from "@/lib/context";
import { amount, date, label, money, today } from "@/lib/format";
import { unitTone } from "@/lib/badges";
import { UNIT_COST_KINDS, type Unit, type UnitCost } from "@/lib/types";
import { addCost, reverseCost, updateUnit } from "../../actions";

export const metadata: Metadata = { title: "Vehicle" };

export default async function UnitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("inventory_units").select("*").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const u = data as Unit;
  const base = ctx.company.base_currency;

  const [{ data: costs }, { data: products }, { data: suppliers }, { data: payFrom }, { data: docs }] = await Promise.all([
    ctx.supabase.from("unit_costs").select("*").eq("unit_id", id).order("cost_date"),
    ctx.supabase.from("products").select("id, name").eq("company_id", ctx.companyId).eq("tracking", "serial").order("name"),
    ctx.supabase.from("crm_accounts").select("id, name").eq("company_id", ctx.companyId).order("name").limit(1000),
    ctx.supabase.from("accounts").select("id, code, name, system_key").eq("company_id", ctx.companyId).in("type", ["asset", "liability"]).eq("is_active", true).order("code"),
    ctx.supabase.from("sales_doc_lines").select("doc_id, sales_docs(id, doc_type, number, status)").eq("company_id", ctx.companyId).eq("unit_id", id),
  ]);
  const costList = (costs ?? []) as UnitCost[];
  const live = costList.filter((c) => !c.reversal_journal_id);
  const landed = live.reduce((s, c) => s + Number(c.amount), 0);
  const final = u.status === "sold" || u.status === "written_off";
  const canCost = ctx.can("inventory.costs") && !final;
  const accounts = (payFrom ?? []) as { id: string; code: string; name: string; system_key: string | null }[];
  const docRows = ((docs ?? []) as unknown as { sales_docs: { id: string; doc_type: string; number: string | null; status: string } | null }[]).map((d) => d.sales_docs).filter(Boolean);

  return (
    <>
      <PageHeader
        title={[u.make, u.model, u.year].filter(Boolean).join(" ") || u.serial_no}
        description={u.vin_confirmed ? <span className="font-mono text-[13px]">VIN {u.serial_no}</span> : <span className="font-medium text-amber-700">VIN not added yet: add it under Vehicle details before invoicing</span>}
        back={{ href: "/inventory/units", label: "Vehicles" }}
        actions={<Badge tone={unitTone[u.status]}>{label(u.status)}</Badge>}
      />
      <Notice params={sp} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Landed cost" flush>
            {costList.length === 0 ? (
              <p className="px-5 py-4 text-ink-soft">No costs yet. Post the purchase price first, then transport, clearing and duty as they come in.</p>
            ) : (
              <Table>
                <thead><tr><Th>Date</Th><Th>Cost</Th><Th>Reference</Th><Th className="text-right">Excl. VAT</Th><Th className="text-right">VAT</Th><Th /></tr></thead>
                <tbody>
                  {costList.map((c) => (
                    <tr key={c.id} className={c.reversal_journal_id ? "text-ink-faint line-through" : ""}>
                      <Td className="whitespace-nowrap">{date(c.cost_date)}</Td>
                      <Td>{label(c.kind)}{c.description && <span className="text-ink-soft">: {c.description}</span>}</Td>
                      <Td className="text-ink-soft">{c.reference}</Td>
                      <Td className="num">{amount(c.amount)}</Td>
                      <Td className="num">{amount(c.vat_amount)}</Td>
                      <Td className="text-right">
                        {canCost && !c.reversal_journal_id && (
                          <form action={reverseCost}>
                            <input type="hidden" name="unit_id" value={id} />
                            <input type="hidden" name="cost_id" value={c.id} />
                            <SubmitButton size="sm" tone="quiet" confirm="Reverse this cost? A reversing journal is posted." pendingText="…">Reverse</SubmitButton>
                          </form>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold"><td colSpan={3} className="px-4 py-3 text-right">Landed cost</td><td className="num px-4 py-3">{money(landed, base)}</td><td colSpan={2} /></tr>
                </tfoot>
              </Table>
            )}
            {canCost && (
              <form action={addCost} className="grid gap-3 border-t border-line bg-paper p-5 sm:grid-cols-3">
                <input type="hidden" name="unit_id" value={id} />
                <Field label="Cost">
                  <Select name="kind" defaultValue={live.length ? "transport" : "purchase"}>
                    {UNIT_COST_KINDS.map((k) => <option key={k} value={k}>{label(k)}</option>)}
                  </Select>
                </Field>
                <Field label={`Amount excl. VAT (${base})`}><Input name="amount" inputMode="decimal" required /></Field>
                <Field label="VAT claimable" hint="Blank if none"><Input name="vat_amount" inputMode="decimal" /></Field>
                <Field label="Paid from or owed on">
                  <Select name="paid_from_account_id" defaultValue={accounts.find((a) => a.system_key === "payables")?.id}>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                  </Select>
                </Field>
                <Field label="Date"><Input name="cost_date" type="date" defaultValue={today()} /></Field>
                <Field label="Supplier invoice or reference"><Input name="reference" /></Field>
                <Field label="Description" className="sm:col-span-2"><Input name="description" placeholder="Auction purchase, Durban to Nairobi road freight" /></Field>
                <div className="flex items-end"><SubmitButton size="sm">Post cost</SubmitButton></div>
              </form>
            )}
          </Panel>

          {ctx.can("inventory.write") && (
            <Panel title="Vehicle details">
              <form action={updateUnit} className="flex flex-col gap-6">
                <input type="hidden" name="id" value={id} />
                <UnitFields unit={u} products={(products ?? []) as { id: string; name: string }[]} suppliers={(suppliers ?? []) as { id: string; name: string }[]} base={base} />
                <div><SubmitButton size="sm" tone="secondary">Save details</SubmitButton></div>
              </form>
            </Panel>
          )}
        </div>
        <div className="flex flex-col gap-6">
          {u.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={u.image_url} alt={[u.make, u.model].filter(Boolean).join(" ")} className="aspect-[4/3] w-full rounded-[var(--radius-panel)] border border-line object-cover" />
          )}
          <Panel title="Summary">
            <Dl
              items={[
                ["Landed cost", <span key="l" className="font-semibold tabular-nums">{money(landed, base)}</span>],
                ["Asking price", u.list_price != null ? money(u.list_price, u.list_currency) : ""],
                ["Location", u.location],
                ["Mileage", u.mileage_km != null ? `${u.mileage_km.toLocaleString("en-US")} km` : ""],
                ["Condition", u.is_second_hand ? "Second-hand" : "New"],
                ...(u.sold_at ? ([["Sold", date(u.sold_at)]] as [string, string][]) : []),
                ...(u.external_id ? ([["On website", u.site_status ? label(u.site_status) : "Listed"]] as [string, string][]) : []),
              ]}
            />
            {!canCost && !final && <p className="mt-3 text-[13px] text-ink-faint">Only owners, admins and accountants can post costs.</p>}
          </Panel>
          {docRows.length > 0 && (
            <Panel title="On documents">
              <ul className="flex flex-col gap-1.5">
                {docRows.map((d) => (
                  <li key={d!.id}><Link className="text-shadow-700 hover:underline" href={`/sales/doc/${d!.id}`}>{d!.number ?? "Draft"}</Link> <span className="text-ink-faint">{label(d!.doc_type)}, {d!.status}</span></li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
