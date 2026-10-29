"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { VinScanner } from "@/components/inventory/vin-scanner";
import { PhotoUploader } from "@/components/inventory/photo-uploader";
import { cleanVin, vinProblem } from "@/lib/vin";
import type { QuickAddResult, VinInfo } from "@/app/(app)/inventory/quick-actions";

type Option = { id: string; label: string };
const big = "h-12 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-[16px] focus:border-shadow-700 focus:outline-none focus:ring-2 focus:ring-shadow-100";
const lbl = "flex flex-col gap-1 text-[13px] font-medium text-ink-soft";
const BODIES = ["Bakkie (single cab)", "Bakkie (double cab)", "Bakkie (extended cab)", "SUV", "Hatchback", "Sedan", "MPV", "Coupe", "Convertible", "Station wagon", "Panel van", "Minibus", "Truck"];

export function QuickAdd({
  companyId, initialVin = "", payFrom, suppliers, vatVendor, canCost, currency = "ZAR",
  decode, add, registerPhotos, saveAdvert,
}: {
  companyId: string;
  initialVin?: string;
  payFrom: Option[];
  suppliers: Option[];
  vatVendor: boolean;
  canCost: boolean;
  /** The company's base currency, for the price labels */
  currency?: string;
  decode: (vin: string) => Promise<VinInfo>;
  add: (input: Parameters<typeof import("@/app/(app)/inventory/quick-actions").quickAddVehicle>[0]) => Promise<QuickAddResult>;
  registerPhotos: (unitId: string, photos: { url: string; path: string }[]) => Promise<{ error?: string }>;
  saveAdvert: (fd: FormData) => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [vin, setVin] = useState(initialVin);
  const [info, setInfo] = useState<VinInfo | null>(null);
  const [f, setF] = useState({ make: "", model: "", variant: "", year: "", mileage: "", colour: "", transmission: "", fuel: "", body: "", location: "", price: "", paidFrom: payFrom[0]?.id ?? "", supplierId: "", privateSeller: true });
  const [unit, setUnit] = useState<{ id: string; stockNo: string } | null>(null);
  const [photos, setPhotos] = useState(0);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const lookUp = (raw: string) => {
    const v = cleanVin(raw);
    setVin(v);
    setError(null);
    const p = vinProblem(v);
    if (p) { setError(p); return; }
    start(async () => {
      const r = await decode(v);
      setInfo(r);
      if (r.error) { setError(r.error); return; }
      setF((x) => ({ ...x, make: r.make ?? x.make, model: r.model ?? x.model, variant: r.variant ?? x.variant, year: r.year ? String(r.year) : x.year, body: r.body ?? x.body, fuel: r.fuel ?? x.fuel, transmission: r.transmission ?? x.transmission }));
      if (!r.existing) setStep(2);
    });
  };

  const save = () => {
    setError(null);
    start(async () => {
      const r = await add({ vin, ...f });
      if (r.id) setUnit({ id: r.id, stockNo: r.stockNo ?? "" });
      if (r.error) setError(r.error);
      if (r.id) setStep(3);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex gap-1.5 text-xs font-medium" aria-label="Steps">
        {["VIN", "Details", "Photos", "Advert"].map((s, i) => (
          <li key={s} className={`flex-1 rounded-full px-2 py-1 text-center ${step === i + 1 ? "bg-shadow-800 text-white" : step > i + 1 ? "bg-jade-50 text-jade-700" : "bg-paper text-ink-faint"}`}>{i + 1}. {s}</li>
        ))}
      </ol>
      {error && <div role="alert" className="rounded-[var(--radius-control)] border border-ember-700/25 bg-ember-50 px-3 py-2 text-[14px] text-ember-700">{error}</div>}

      {step === 1 && (
        <section className="flex flex-col gap-4">
          <VinScanner onVin={lookUp} />
          <label className={lbl}>Or type the VIN
            <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} maxLength={20} autoCapitalize="characters" autoComplete="off" spellCheck={false} className={`${big} font-mono tracking-wider uppercase`} placeholder="17 characters" />
          </label>
          <button type="button" disabled={pending} onClick={() => lookUp(vin)} className={`${buttonClass("primary")} h-12 text-[16px]`}>{pending ? "Looking up…" : "Next"}</button>
          {info?.existing && (
            <div className="rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-[14px] text-amber-700">
              Already in your stock: <Link className="font-medium underline" href={`/inventory/units/${info.existing.id}`}>{info.existing.label}</Link> ({info.existing.status.replace(/_/g, " ")})
            </div>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-4">
          <p className="font-mono text-[15px] tracking-wider">{vin}</p>
          {info?.source === "vpic" && <p className="text-[13px] text-jade-700">Details filled in from the VIN. Check them.</p>}
          {info?.source === "local" && <p className="text-[13px] text-ink-soft">Make{info.year ? " and likely year" : ""} worked out from the VIN. Fill in the rest.</p>}
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}>Make<input className={big} value={f.make} onChange={(e) => set("make", e.target.value)} /></label>
            <label className={lbl}>Model<input className={big} value={f.model} onChange={(e) => set("model", e.target.value)} /></label>
            <label className={`${lbl} col-span-2`}>Variant<input className={big} value={f.variant} onChange={(e) => set("variant", e.target.value)} placeholder="2.8 GD-6 Raider double cab" /></label>
            <label className={lbl}>Year<input className={big} inputMode="numeric" value={f.year} onChange={(e) => set("year", e.target.value)} /></label>
            <label className={lbl}>Mileage (km)<input className={big} inputMode="numeric" value={f.mileage} onChange={(e) => set("mileage", e.target.value)} /></label>
            <label className={lbl}>Colour<input className={big} value={f.colour} onChange={(e) => set("colour", e.target.value)} /></label>
            <label className={lbl}>Gearbox<select className={big} value={f.transmission} onChange={(e) => set("transmission", e.target.value)}><option value="">Not set</option><option>Manual</option><option>Automatic</option></select></label>
            <label className={lbl}>Fuel<select className={big} value={f.fuel} onChange={(e) => set("fuel", e.target.value)}><option value="">Not set</option><option>Petrol</option><option>Diesel</option><option>Hybrid</option><option>Electric</option></select></label>
            <label className={lbl}>Body<select className={big} value={f.body} onChange={(e) => set("body", e.target.value)}><option value="">Not set</option>{BODIES.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className={`${lbl} col-span-2`}>Where it&apos;s parked<input className={big} value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Main lot, bay 4" /></label>
          </div>
          {canCost && (
            <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-control)] bg-paper p-3">
              <label className={`${lbl} col-span-2`}>What you paid ({currency === "ZAR" ? "R" : currency}, optional)<input className={big} inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} /></label>
              <label className={lbl}>Paid from<select className={big} value={f.paidFrom} onChange={(e) => set("paidFrom", e.target.value)}>{payFrom.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
              <label className={lbl}>Bought from<select className={big} value={f.supplierId} onChange={(e) => set("supplierId", e.target.value)}><option value="">Not recorded</option>{suppliers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
              {vatVendor && <label className="col-span-2 flex items-center gap-2 text-[14px]"><input type="checkbox" checked={f.privateSeller} onChange={(e) => set("privateSeller", e.target.checked)} className="size-5 accent-jade-700" /> Bought from a private seller (claim notional VAT)</label>}
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className={`${buttonClass("secondary")} h-12`}>Back</button>
            <button type="button" disabled={pending} onClick={save} className={`${buttonClass("primary")} h-12 flex-1 text-[16px]`}>{pending ? "Saving…" : "Save car"}</button>
          </div>
        </section>
      )}

      {step === 3 && unit && (
        <section className="flex flex-col gap-4">
          <p className="text-[15px]"><strong>{unit.stockNo}</strong> is in stock. Add photos: front three-quarter first, then sides, back, interior, dashboard and engine.</p>
          <PhotoUploader companyId={companyId} unitId={unit.id} register={async (id, p) => { const r = await registerPhotos(id, p); if (!r.error) setPhotos((n) => n + p.length); return r; }} />
          <p className="text-[14px] text-ink-soft">{photos} photo{photos === 1 ? "" : "s"} added.</p>
          <button type="button" onClick={() => setStep(4)} className={`${buttonClass("primary")} h-12 text-[16px]`}>{photos ? "Next" : "Skip photos for now"}</button>
        </section>
      )}

      {step === 4 && unit && (
        <form action={saveAdvert} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={unit.id} />
          <input type="hidden" name="transmission" value={f.transmission} />
          <input type="hidden" name="fuel_type" value={f.fuel} />
          <input type="hidden" name="body_type" value={f.body} />
          <label className={lbl}>Asking price ({currency === "ZAR" ? "R" : currency}{vatVendor ? ", incl. VAT" : ""})<input name="advert_price" className={big} inputMode="decimal" required /></label>
          <label className={lbl}>Features (one per line)<textarea name="features" rows={3} className={`${big} h-auto py-2`} placeholder={"Service history\nTow bar\nCanopy"} /></label>
          <label className={lbl}>Description<textarea name="advert_description" rows={3} className={`${big} h-auto py-2`} /></label>
          <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" name="is_published" defaultChecked className="size-5 accent-jade-700" /> Advertise it on my feeds now</label>
          <button type="submit" className={`${buttonClass("primary")} h-12 text-[16px]`}>Finish</button>
          <Link href={`/inventory/units/${unit.id}`} className="text-center text-[14px] text-shadow-700 hover:underline">Skip, open the car</Link>
        </form>
      )}
    </div>
  );
}
