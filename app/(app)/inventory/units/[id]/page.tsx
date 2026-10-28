import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Dl, Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { PhotoUploader } from "@/components/inventory/photo-uploader";
import { Timeline } from "@/components/timeline";
import type { ObjectEvent } from "@/lib/ontology";
import { SubmitButton } from "@/components/submit-button";
import { UnitFields } from "@/components/inventory/unit-fields";
import { getContext } from "@/lib/context";
import { amount, date, label, money, today } from "@/lib/format";
import { unitTone } from "@/lib/badges";
import { UNIT_COST_KINDS, type Unit, type UnitCost, type VehiclePhoto } from "@/lib/types";
import { askingNet, netProfit, type VehicleProfit } from "@/lib/profit";
import { addCost, makeMainPhoto, registerPhotos, removePhoto, reverseCost, saveAdvert, updateUnit } from "../../actions";

const TRANSMISSIONS = ["Manual", "Automatic"];
const FUELS = ["Petrol", "Diesel", "Hybrid", "Electric"];
const BODIES = ["Bakkie (single cab)", "Bakkie (double cab)", "Bakkie (extended cab)", "SUV", "Hatchback", "Sedan", "MPV", "Coupe", "Convertible", "Station wagon", "Panel van", "Minibus", "Truck"];

export const metadata: Metadata = { title: "Vehicle" };

export default async function UnitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string; h?: string }> }) {
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
  const { data: photoData } = await ctx.supabase.from("vehicle_photos").select("id, unit_id, url, storage_path, position").eq("unit_id", id).order("position").order("created_at");
  const photos = (photoData ?? []) as VehiclePhoto[];
  const { data: profitData } = ctx.can("ledger.write") ? await ctx.supabase.from("vehicle_profit").select("*").eq("unit_id", id).maybeSingle() : { data: null };
  const vp = profitData as VehicleProfit | null;
  const { data: eventData } = await ctx.supabase.from("object_events").select("*").eq("company_id", ctx.companyId).eq("subject_type", "vehicle").eq("subject_id", id).order("at", { ascending: false }).limit(300);
  const ask = vp ? askingNet(vp, !!ctx.company.vat_no?.trim()) : null;
  const canAdvert = ctx.can("inventory.write");
  const options = (list: string[], current: string | null) => [...new Set([...(current ? [current] : []), ...list])];
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
          <Panel title={<span className="flex items-center gap-2">Advert {u.is_published ? <Badge tone="jade">Live on feeds</Badge> : <Badge>Not published</Badge>}</span>}>
            <form action={saveAdvert} className="flex flex-col gap-4">
              <input type="hidden" name="id" value={id} />
              <fieldset disabled={!canAdvert || final} className="contents">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="is_published" defaultChecked={u.is_published} className="size-4 accent-jade-700" />
                  Publish to my stock feeds (AutoTrader, Cars.co.za, website)
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Advertised price (${u.list_currency})`} hint={u.list_price != null ? `Blank uses the list price, ${money(u.list_price, u.list_currency)}` : undefined}>
                    <Input name="advert_price" inputMode="decimal" defaultValue={u.advert_price ?? ""} />
                  </Field>
                  <Field label="Headline" hint="Blank uses year, make, model and variant"><Input name="advert_title" defaultValue={u.advert_title ?? ""} placeholder={[u.year, u.make, u.model, u.variant].filter(Boolean).join(" ")} /></Field>
                  <Field label="Transmission"><Select name="transmission" defaultValue={u.transmission ?? ""}><option value="">Not set</option>{options(TRANSMISSIONS, u.transmission).map((o) => <option key={o}>{o}</option>)}</Select></Field>
                  <Field label="Fuel"><Select name="fuel_type" defaultValue={u.fuel_type ?? ""}><option value="">Not set</option>{options(FUELS, u.fuel_type).map((o) => <option key={o}>{o}</option>)}</Select></Field>
                  <Field label="Body type"><Select name="body_type" defaultValue={u.body_type ?? ""}><option value="">Not set</option>{options(BODIES, u.body_type).map((o) => <option key={o}>{o}</option>)}</Select></Field>
                  <Field label="Features" hint="One per line or separated by commas"><Textarea name="features" rows={3} defaultValue={(u.features ?? []).join("\n")} placeholder={"Tow bar\nService history\nLeather seats"} /></Field>
                  <Field label="Description" className="sm:col-span-2"><Textarea name="advert_description" rows={4} defaultValue={u.advert_description ?? u.description ?? ""} placeholder="Full service history, one owner, spare key…" /></Field>
                </div>
                {canAdvert && !final && <div><SubmitButton size="sm">Save advert</SubmitButton></div>}
              </fieldset>
              {final && <p className="text-[13px] text-ink-faint">Sold vehicles are taken off all feeds automatically.</p>}
            </form>
          </Panel>

          <Panel title="Landed cost" flush>
            {!ctx.can("inventory.costs") ? (
              <p className="px-5 py-4 text-ink-soft">Costs are visible to owners, admins and accountants.</p>
            ) : costList.length === 0 ? (
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
                    {UNIT_COST_KINDS.map((k) => <option key={k} value={k}>{k === "repairs" ? "Reconditioning and repairs" : label(k)}</option>)}
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

          <Panel title="History" action={<span className="text-xs text-ink-faint">Everything that happened to this car, from every department</span>}>
            <Timeline events={(eventData ?? []) as ObjectEvent[]} basePath={`/inventory/units/${id}`} active={sp.h} />
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
          <Panel title={`Photos (${photos.length})`}>
            {photos.length === 0 && u.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u.image_url} alt="" className="mb-3 aspect-[4/3] w-full rounded-[var(--radius-control)] object-cover" />
            )}
            {photos.length > 0 && (
              <ul className="mb-3 grid grid-cols-2 gap-2">
                {photos.map((p, i) => (
                  <li key={p.id} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className={`aspect-[4/3] w-full rounded-[var(--radius-control)] object-cover ${i === 0 ? "ring-2 ring-jade-600" : ""}`} />
                    {i === 0 && <span className="absolute top-1 left-1 rounded bg-jade-700 px-1.5 py-0.5 text-[11px] font-medium text-white">Main</span>}
                    {canAdvert && (
                      <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1">
                        {i > 0 ? (
                          <form action={makeMainPhoto}><input type="hidden" name="unit_id" value={id} /><input type="hidden" name="id" value={p.id} /><button className="rounded bg-shadow-900/80 px-1.5 py-0.5 text-[11px] text-white">Make main</button></form>
                        ) : <span />}
                        <form action={removePhoto}><input type="hidden" name="unit_id" value={id} /><input type="hidden" name="id" value={p.id} /><button className="rounded bg-shadow-900/80 px-1.5 py-0.5 text-[11px] text-white" aria-label="Remove photo">Remove</button></form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canAdvert && !final && <PhotoUploader companyId={ctx.companyId} unitId={id} register={registerPhotos} />}
          </Panel>
          {vp && (
            <Panel title={vp.invoice_id ? "Profit on this car" : "Expected profit"}>
              {vp.invoice_id ? (
                <Dl items={[
                  ["Sold for (excl. VAT)", money(vp.sale_net)],
                  ["Cost of the car", `-${money(vp.cogs ?? vp.landed_cost)}`],
                  ["Gross profit", <strong key="g" className={Number(vp.gross_profit) < 0 ? "text-ember-700" : ""}>{money(vp.gross_profit)}</strong>],
                  ...(Number(vp.addon_profit) ? ([["Add-ons", money(vp.addon_profit)]] as [string, string][]) : []),
                  ...(Number(vp.finance_income) ? ([["Finance commission", money(vp.finance_income)]] as [string, string][]) : []),
                  ...(Number(vp.commission) ? ([["Sales commission", `-${money(vp.commission)}`]] as [string, string][]) : []),
                  ["Net profit", <strong key="n" className={netProfit(vp) < 0 ? "text-ember-700" : "text-jade-700"}>{money(netProfit(vp))}</strong>],
                  ["Days to sell", String(vp.days_in_stock)],
                ]} />
              ) : (
                <Dl items={[
                  ["Landed cost so far", money(vp.landed_cost)],
                  ["Asking excl. VAT", ask !== null ? money(ask) : "Set a price"],
                  ["Gross at asking", ask !== null ? <strong key="e" className={ask - Number(vp.landed_cost) < 0 ? "text-ember-700" : ""}>{money(ask - Number(vp.landed_cost))}</strong> : ""],
                  ["Days in stock", <span key="d" className={vp.days_in_stock > 90 ? "font-semibold text-amber-700" : ""}>{vp.days_in_stock}</span>],
                ]} />
              )}
            </Panel>
          )}
          <Panel title="Summary">
            <Dl
              items={[
                ["Stock number", <span key="s" className="font-mono">{u.stock_no}</span>],
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
