import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Empty, Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { date, label, moneyFor } from "@/lib/format";
import { fail } from "@/lib/forms";
import { acceptTransfer, declineTransfer } from "../transfer-actions";

export const metadata: Metadata = { title: "Incoming cars" };

type Transfer = {
  id: string; from_name: string; invoice_number: string | null; status: string; created_at: string; decided_at: string | null; to_unit_id: string | null;
  details: { vin?: string; make?: string; model?: string; variant?: string; year?: number; colour?: string; mileage_km?: number; transmission?: string; fuel_type?: string; features?: string[]; advert_description?: string };
  photos: string[]; price_net: number | null; price_vat: number | null; currency: string;
};

const TONE: Record<string, "amber" | "jade" | "neutral" | "ember"> = { pending: "amber", accepted: "jade", declined: "neutral", cancelled: "neutral" };

export default async function IncomingPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail("/inventory/units", "Your role can't add stock");
  const money = moneyFor(ctx.company.base_currency);
  const canCost = ctx.can("inventory.costs");
  const vatVendor = !!ctx.company.vat_no?.trim();
  const [{ data }, { data: accts }] = await Promise.all([
    ctx.supabase.from("vehicle_transfers").select("*").eq("to_company_id", ctx.companyId).order("created_at", { ascending: false }).limit(100),
    canCost
      ? ctx.supabase.from("accounts").select("id, code, name, system_key, type").eq("company_id", ctx.companyId).eq("is_active", true).in("type", ["asset", "liability"]).order("code")
      : Promise.resolve({ data: [] }),
  ]);
  const all = (data ?? []) as Transfer[];
  const pending = all.filter((t) => t.status === "pending");
  const done = all.filter((t) => t.status !== "pending");
  type A = { id: string; code: string; name: string; system_key: string | null; type: string };
  const accounts = (accts ?? []) as A[];
  const payFrom = [
    ...accounts.filter((a) => a.system_key === "payables").map((a) => ({ id: a.id, label: "Owe the seller (pay later)" })),
    ...accounts.filter((a) => a.system_key === "bank" || (a.type === "asset" && a.code < "1100" && !a.system_key)).map((a) => ({ id: a.id, label: `Paid from ${a.name}` })),
  ];
  const title = (t: Transfer) => [t.details.year, t.details.make, t.details.model, t.details.variant].filter(Boolean).join(" ") || "Vehicle";

  return (
    <>
      <PageHeader
        title="Incoming cars"
        description={`Cars other Kageflow dealers have invoiced to you. Give sellers your dealer code ${ctx.company.dealer_code} so their cars arrive here with details and photos.`}
        back={{ href: "/inventory/units", label: "Vehicles" }}
      />
      <Notice params={sp} />

      {pending.length === 0 ? (
        <Panel className="mb-6"><Empty title="No cars waiting">When a dealer on Kageflow invoices you a car, it appears here for you to accept into stock.</Empty></Panel>
      ) : (
        <div className="mb-8 flex flex-col gap-4">
          {pending.map((t) => {
            const sameCurrency = t.currency === ctx.company.base_currency;
            return (
              <Panel key={t.id}>
                <div className="grid gap-5 md:grid-cols-[220px_1fr]">
                  <div>
                    {t.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.photos[0]} alt="" className="aspect-[4/3] w-full rounded-[var(--radius-control)] object-cover" />
                    ) : (
                      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-[var(--radius-control)] bg-paper text-[13px] text-ink-faint">No photos</div>
                    )}
                    <p className="mt-1 text-xs text-ink-faint">{t.photos.length} photo{t.photos.length === 1 ? "" : "s"}</p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div>
                      <div className="text-[17px] font-semibold">{title(t)}</div>
                      <div className="text-[13px] text-ink-soft">
                        From <strong>{t.from_name}</strong>{t.invoice_number ? ` on invoice ${t.invoice_number}` : ""}, {date(t.created_at.slice(0, 10))}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-soft">
                      {t.details.vin && <span>VIN <span className="font-mono text-ink">{t.details.vin}</span></span>}
                      {t.details.mileage_km != null && <span>{Number(t.details.mileage_km).toLocaleString("en-ZA")} km</span>}
                      {t.details.colour && <span>{t.details.colour}</span>}
                      {t.details.transmission && <span>{label(t.details.transmission)}</span>}
                      {t.details.fuel_type && <span>{label(t.details.fuel_type)}</span>}
                      {t.price_net != null && <span>Invoiced at <span className="text-ink">{money(Number(t.price_net) + Number(t.price_vat ?? 0), t.currency)}</span>{Number(t.price_vat) > 0 ? " incl. VAT" : ""}</span>}
                    </div>
                    <form action={acceptTransfer} className="grid gap-3 rounded-[var(--radius-control)] border border-line p-3 sm:grid-cols-2">
                      <input type="hidden" name="id" value={t.id} />
                      <Field label="Where the car will be"><Input name="location" placeholder="Main yard" /></Field>
                      {canCost && (
                        <>
                          <label className="flex items-center gap-2 self-end pb-2 text-sm">
                            <input type="checkbox" name="post_cost" defaultChecked={sameCurrency} className="size-4 accent-jade-700" /> Post what we paid as the purchase cost
                          </label>
                          <Field label={`Amount excl. VAT (${ctx.company.base_currency})`} hint={sameCurrency ? "From the seller's invoice" : `The seller invoiced in ${t.currency}: enter the ${ctx.company.base_currency} amount`}>
                            <Input name="amount" inputMode="decimal" defaultValue={sameCurrency && t.price_net != null ? String(t.price_net) : ""} />
                          </Field>
                          {vatVendor && (
                            <Field label="VAT on the seller's invoice" hint="Claimable if they charged VAT">
                              <Input name="vat" inputMode="decimal" defaultValue={sameCurrency && t.price_vat != null ? String(t.price_vat) : "0"} />
                            </Field>
                          )}
                          <Field label="Paid" className={vatVendor ? "sm:col-span-2" : ""}>
                            <Select name="paid_from" defaultValue={payFrom[0]?.id}>{payFrom.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
                          </Field>
                        </>
                      )}
                      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                        <SubmitButton pendingText="Adding to stock and copying photos…">Accept into stock</SubmitButton>
                      </div>
                    </form>
                    <form action={declineTransfer}>
                      <input type="hidden" name="id" value={t.id} />
                      <SubmitButton tone="quiet" size="sm" confirm="Decline this car? The seller will see it was declined.">Decline</SubmitButton>
                    </form>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <Panel title="Earlier" flush>
          <Table>
            <thead><tr><Th>Car</Th><Th>From</Th><Th>Sent</Th><Th>Status</Th></tr></thead>
            <tbody>
              {done.map((t) => (
                <tr key={t.id}>
                  <Td>{t.to_unit_id ? <Link className="font-medium hover:underline" href={`/inventory/units/${t.to_unit_id}`}>{title(t)}</Link> : title(t)}<div className="font-mono text-xs text-ink-faint">{t.details.vin}</div></Td>
                  <Td>{t.from_name}{t.invoice_number ? <div className="text-xs text-ink-faint">{t.invoice_number}</div> : null}</Td>
                  <Td>{date(t.created_at.slice(0, 10))}</Td>
                  <Td><Badge tone={TONE[t.status] ?? "neutral"}>{label(t.status)}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
