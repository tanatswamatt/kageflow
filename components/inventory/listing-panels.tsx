import { Badge, Dl, Field, Input, Panel, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { date, moneyFor, today } from "@/lib/format";
import type { Unit } from "@/lib/types";
import { buyListedCar, inspectCar, removeListingAction, shareCar, withdrawShareAction } from "@/app/(app)/inventory/listing-actions";

type Option = { id: string; label: string };

/** A car on an approved supplier's floor: check it, then buy it before invoicing */
export function SupplierListingPanel({ unit: u, supplier, canBuy, payFrom, vatVendor, vatRate }: {
  unit: Unit;
  supplier: { name: string; vat_no: string | null } | null;
  canBuy: boolean;
  payFrom: Option[];
  vatVendor: boolean;
  vatRate: number;
}) {
  const money = moneyFor(u.list_currency);
  const vinPending = u.serial_no.startsWith("TBC-");
  const inspected = !!u.inspected_at && u.vin_confirmed && !vinPending;
  const ask = u.advert_price ?? u.list_price;
  const price = u.supplier_price != null ? Number(u.supplier_price) : null;
  // the supplier's price includes VAT when they are VAT registered; we can claim it when we are too
  const claimVat = vatVendor && !!supplier?.vat_no?.trim();
  const net = price != null ? (claimVat ? Math.round((price / (1 + vatRate)) * 100) / 100 : price) : null;
  const vat = price != null && net != null ? Math.round((price - net) * 100) / 100 : 0;

  return (
    <Panel title={<span className="flex items-center gap-2">On {supplier?.name ?? "the supplier"}&apos;s floor <Badge tone="amber">Not bought yet</Badge></span>}>
      <p className="mb-4 text-[13px] text-ink-soft">
        You&apos;re advertising this car for the supplier. It isn&apos;t in your stock value or your books until you buy it. When a customer commits: inspect it, then buy it, then invoice the customer.
      </p>
      <Dl items={[
        ["Supplier", supplier?.name ?? ""],
        ["Supplier's price", price != null ? money(price, u.supplier_currency ?? u.list_currency) : "Not recorded"],
        ["Your asking price", ask != null ? money(ask) : "Set it under Advert"],
        ["Margin at asking", ask != null && price != null ? <strong key="m" className={Number(ask) - price < 0 ? "text-ember-700" : ""}>{money(Number(ask) - price)}</strong> : ""],
        ["Registration", u.registration_no ?? ""],
        ["VIN", vinPending ? <span key="v" className="text-amber-700">To follow at inspection</span> : inspected ? <span key="v">{u.serial_no} <span className="text-jade-700">(checked on the car {date(u.inspected_at!.slice(0, 10))})</span></span> : <span key="v">{u.serial_no} <span className="text-amber-700">(from the document, not yet checked on the car)</span></span>],
      ]} />

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <form action={inspectCar} className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-line p-4">
          <input type="hidden" name="id" value={u.id} />
          <div className="text-[14px] font-semibold">1. Inspect it {inspected && <Badge tone="jade">Done</Badge>}</div>
          <Field label="VIN on the car" hint="Windscreen, door frame or chassis plate. It must match the registration document">
            <Input name="vin" defaultValue={vinPending ? "" : u.serial_no} required autoCapitalize="characters" className="font-mono" />
          </Field>
          {!vinPending && !inspected && (
            <label className="flex items-center gap-2 text-[13px] text-ink-soft"><input type="checkbox" name="override" className="size-4 accent-jade-700" /> The car&apos;s VIN differs from the one recorded, and I&apos;ve checked why</label>
          )}
          <div><SubmitButton size="sm" tone="secondary">{inspected ? "Inspect again" : "Confirm VIN"}</SubmitButton></div>
        </form>

        {canBuy ? (
          <form action={buyListedCar} className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-line p-4">
            <input type="hidden" name="id" value={u.id} />
            <div className="text-[14px] font-semibold">2. Buy it</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price excl. VAT"><Input name="amount" inputMode="decimal" defaultValue={net ?? ""} required /></Field>
              {vatVendor ? <Field label="VAT on their invoice"><Input name="vat" inputMode="decimal" defaultValue={vat || "0"} /></Field> : <div />}
              <Field label="Paid">
                <Select name="paid_from" defaultValue={payFrom[0]?.id}>{payFrom.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
              </Field>
              <Field label="Date"><Input name="date" type="date" defaultValue={today()} /></Field>
              <Field label="Their invoice number" className="col-span-2"><Input name="reference" /></Field>
            </div>
            {!inspected && <p className="text-[13px] text-amber-700">Inspect it and confirm the VIN first.</p>}
            <div><SubmitButton size="sm" confirm="Buy this car? It becomes your stock and the cost is posted.">Buy from supplier</SubmitButton></div>
          </form>
        ) : (
          <p className="rounded-[var(--radius-control)] border border-line p-4 text-[13px] text-ink-soft">An owner, admin or accountant buys the car once it&apos;s inspected.</p>
        )}
      </div>

      <form action={removeListingAction} className="mt-4">
        <input type="hidden" name="id" value={u.id} />
        <SubmitButton size="sm" tone="quiet" confirm="Take this listing down? It comes off your feeds.">Remove listing (sold elsewhere or no longer wanted)</SubmitButton>
      </form>
    </Panel>
  );
}

type Share = { id: string; status: string; price: number; currency: string; to_name: string | null; created_at: string };

const SHARE_LABEL: Record<string, [string, "amber" | "jade" | "neutral" | "shadow"]> = {
  offered: ["Waiting for them", "amber"], listed: ["Advertising it", "jade"], bought: ["They bought it", "shadow"],
  declined: ["Declined", "neutral"], withdrawn: ["Withdrawn", "neutral"], sold: ["Ended: sold", "neutral"],
};

/** The supplier's side: let a dealer on Kageflow advertise this car */
export function ShareCarPanel({ unitId, shares, defaultPrice, currency }: { unitId: string; shares: Share[]; defaultPrice: number | null; currency: string }) {
  const money = moneyFor(currency);
  const back = `/inventory/units/${unitId}`;
  return (
    <Panel title="Let another dealer advertise it">
      <p className="mb-3 text-[13px] text-ink-soft">They list it on their site with your photos and details, and it comes off their site when you sell it. They never see your costs.</p>
      {shares.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2 text-[13px]">
          {shares.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <span>{s.to_name ?? "Dealer"} <span className="text-ink-faint">at {money(s.price, s.currency)}</span></span>
              <span className="flex items-center gap-2">
                <Badge tone={SHARE_LABEL[s.status]?.[1] ?? "neutral"}>{SHARE_LABEL[s.status]?.[0] ?? s.status}</Badge>
                {(s.status === "offered" || s.status === "listed") && (
                  <form action={withdrawShareAction}>
                    <input type="hidden" name="id" value={s.id} /><input type="hidden" name="back" value={back} />
                    <SubmitButton size="sm" tone="quiet" confirm="Withdraw this car from their listings?">Withdraw</SubmitButton>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form action={shareCar} className="flex flex-col gap-3">
        <input type="hidden" name="unit_id" value={unitId} />
        <Field label="Their dealer code"><Input name="code" placeholder="KF-1A2B3C" required autoCapitalize="characters" /></Field>
        <Field label={`Price to them (${currency})`} hint="What they would pay you. Share again with the same code to change it">
          <Input name="price" inputMode="decimal" defaultValue={defaultPrice ?? ""} required />
        </Field>
        <Field label="Note (optional)"><Input name="note" placeholder="Price excludes VAT; viewing by appointment" /></Field>
        <div><SubmitButton size="sm" tone="secondary">Share the car</SubmitButton></div>
      </form>
    </Panel>
  );
}
