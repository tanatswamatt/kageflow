import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Notice, PageHeader, Panel, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { StockCheckScanner } from "@/components/inventory/stock-check-scanner";
import { getContext } from "@/lib/context";
import { dateTime } from "@/lib/format";
import { addScan, closeCheck, removeScan } from "../actions";

export const metadata: Metadata = { title: "Stock check" };

type U = { id: string; stock_no: string | null; serial_no: string; make: string | null; model: string | null; year: number | null; status: string; location: string | null };

export default async function StockCheckPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getContext();
  const { data: c } = await ctx.supabase.from("stock_checks").select("*").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!c) notFound();
  const open = c.status === "open";
  let unitsQ = ctx.supabase.from("inventory_units").select("id, stock_no, serial_no, make, model, year, status, location").eq("company_id", ctx.companyId).in("status", ["in_stock", "reserved"]).limit(5000);
  if (c.location) unitsQ = unitsQ.ilike("location", `${c.location}%`);
  const [{ data: scanData }, { data: unitData }] = await Promise.all([
    ctx.supabase.from("stock_check_scans").select("id, vin, unit_id, scanned_at").eq("check_id", id).order("scanned_at", { ascending: false }),
    unitsQ,
  ]);
  const scans = (scanData ?? []) as { id: string; vin: string; unit_id: string | null; scanned_at: string }[];
  const units = (unitData ?? []) as U[];
  const seen = new Set(scans.map((s) => s.unit_id).filter(Boolean));
  const missing = units.filter((u) => !seen.has(u.id));
  const unknown = scans.filter((s) => !s.unit_id);
  const byId = new Map(units.map((u) => [u.id, u]));
  const label = (u: U) => `${u.stock_no ?? ""} ${[u.year, u.make, u.model].filter(Boolean).join(" ")}`.trim();

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3">{c.name} <Badge tone={open ? "amber" : "neutral"}>{open ? "In progress" : "Closed"}</Badge></span>} description={c.location ? `Location: ${c.location}` : "Whole stock"} back={{ href: "/inventory/stock-check", label: "Stock checks" }} />
      <Notice params={sp} />
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Should be here" value={String(units.length)} />
        <Stat label="Scanned" value={String(scans.length - unknown.length)} />
        <Stat label="Not found yet" value={<span className={missing.length ? "text-ember-700" : ""}>{missing.length}</span>} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {open && (
          <Panel title="Scan">
            <StockCheckScanner checkId={id} add={addScan} />
            <form action={closeCheck} className="mt-5 border-t border-line pt-4">
              <input type="hidden" name="id" value={id} />
              <SubmitButton tone="secondary" confirm={missing.length ? `${missing.length} cars haven't been scanned. Close anyway?` : undefined}>Finish and close</SubmitButton>
            </form>
          </Panel>
        )}
        <div className="flex flex-col gap-6">
          {missing.length > 0 && (
            <Panel title={`Not found yet (${missing.length})`}>
              <ul className="flex flex-col gap-1.5 text-sm">
                {missing.map((u) => <li key={u.id}><Link className="font-medium hover:underline" href={`/inventory/units/${u.id}`}>{label(u)}</Link> <span className="font-mono text-xs text-ink-faint">{u.serial_no}</span>{u.location && <span className="text-xs text-ink-faint"> · {u.location}</span>}</li>)}
              </ul>
            </Panel>
          )}
          {unknown.length > 0 && (
            <Panel title={`On the lot but not in Kageflow (${unknown.length})`}>
              <ul className="flex flex-col gap-1.5 text-sm">
                {unknown.map((s) => <li key={s.id} className="flex items-center justify-between gap-2"><span className="font-mono">{s.vin}</span><Link className="text-[13px] font-medium text-shadow-700 hover:underline" href={`/inventory/quick-add?vin=${s.vin}`}>Add this car</Link></li>)}
              </ul>
            </Panel>
          )}
          <Panel title={`Scanned (${scans.length})`}>
            {scans.length === 0 ? <p className="text-sm text-ink-soft">Nothing scanned yet.</p> : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {scans.map((s) => {
                  const u = s.unit_id ? byId.get(s.unit_id) : null;
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-2">
                      <span>{u ? label(u) : s.unit_id ? "Car not expected on this check (sold or other location)" : "Not in Kageflow"} <span className="font-mono text-xs text-ink-faint">{s.vin}</span> <span className="text-xs text-ink-faint">{dateTime(s.scanned_at)}</span></span>
                      {open && <form action={removeScan}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="check_id" value={id} /><button className="text-xs text-ink-faint hover:text-ember-700">Remove</button></form>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
