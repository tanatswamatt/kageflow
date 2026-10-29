import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Empty, Field, Input, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { date, moneyFor } from "@/lib/format";
import { fail } from "@/lib/forms";
import { acceptShareAction, declineShareAction } from "../listing-actions";

export const metadata: Metadata = { title: "Shared with you" };

type Share = { id: string; status: string; price: number; currency: string; note: string | null; from_name: string | null; created_at: string; unit_id: string; broker_unit_id: string | null };
type Car = { id: string; make: string | null; model: string | null; variant: string | null; year: number | null; mileage_km: number | null; colour: string | null; image_url: string | null };

const STATUS: Record<string, [string, "amber" | "jade" | "neutral" | "shadow"]> = {
  listed: ["Advertising", "jade"], bought: ["Bought", "shadow"], declined: ["Declined", "neutral"], withdrawn: ["Withdrawn by supplier", "neutral"], sold: ["Sold by supplier", "neutral"],
};

export default async function SharedPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail("/inventory/units", "Your role can't add stock");
  const money = moneyFor(ctx.company.base_currency);
  const { data } = await ctx.supabase.from("stock_shares").select("*").eq("to_company_id", ctx.companyId).order("created_at", { ascending: false }).limit(200);
  const shares = (data ?? []) as Share[];
  // the supplier's car details travel through the share: read them from our listing, or (for offers) from the share's own snapshot
  const offered = shares.filter((s) => s.status === "offered");
  const { data: carData } = offered.length
    ? await ctx.supabase.rpc("shared_cars", { p_ids: offered.map((s) => s.id) })
    : { data: [] };
  const cars = new Map(((carData ?? []) as (Car & { share_id: string })[]).map((c) => [c.share_id, c]));
  const rest = shares.filter((s) => s.status !== "offered");
  const title = (c?: Car) => (c ? [c.year, c.make, c.model, c.variant].filter(Boolean).join(" ") : "Vehicle");

  return (
    <>
      <PageHeader
        title="Shared with you"
        description={`Cars suppliers on Kageflow let you advertise. They stay on the supplier's floor until you buy them. Your dealer code is ${ctx.company.dealer_code}.`}
        back={{ href: "/inventory/units?v=listed", label: "Supplier listings" }}
      />
      <Notice params={sp} />
      {offered.length === 0 ? (
        <Panel className="mb-6"><Empty title="Nothing new">When a supplier shares a car with your dealer code, it appears here for you to list.</Empty></Panel>
      ) : (
        <div className="mb-8 flex flex-col gap-4">
          {offered.map((s) => {
            const c = cars.get(s.id);
            return (
              <Panel key={s.id}>
                <div className="grid gap-5 md:grid-cols-[200px_1fr]">
                  {c?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.image_url} alt="" className="aspect-[4/3] w-full rounded-[var(--radius-control)] object-cover" />
                  ) : <div className="flex aspect-[4/3] w-full items-center justify-center rounded-[var(--radius-control)] bg-paper text-[13px] text-ink-faint">No photo</div>}
                  <div className="flex flex-col gap-3">
                    <div>
                      <div className="text-[17px] font-semibold">{title(c)}</div>
                      <div className="text-[13px] text-ink-soft">From <strong>{s.from_name ?? "a supplier"}</strong>, {date(s.created_at.slice(0, 10))}{c?.mileage_km != null ? ` · ${Number(c.mileage_km).toLocaleString("en-ZA")} km` : ""}{c?.colour ? ` · ${c.colour}` : ""}</div>
                      <div className="mt-1 text-[14px]">Their price to you: <strong>{money(s.price, s.currency)}</strong></div>
                      {s.note && <div className="mt-1 text-[13px] text-ink-soft">“{s.note}”</div>}
                    </div>
                    <form action={acceptShareAction} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="id" value={s.id} />
                      <Field label={`Your asking price (${ctx.company.base_currency})`}><Input name="price" inputMode="decimal" className="w-44" /></Field>
                      <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="publish" defaultChecked className="size-4 accent-jade-700" /> Advertise now</label>
                      <SubmitButton pendingText="Listing…">List it</SubmitButton>
                    </form>
                    <form action={declineShareAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <SubmitButton tone="quiet" size="sm">Decline</SubmitButton>
                    </form>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
      {rest.length > 0 && (
        <Panel title="Earlier" flush>
          <Table>
            <thead><tr><Th>From</Th><Th>Shared</Th><Th className="text-right">Their price</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {rest.map((s) => (
                <tr key={s.id}>
                  <Td>{s.from_name ?? "Supplier"}</Td>
                  <Td>{date(s.created_at.slice(0, 10))}</Td>
                  <Td className="num">{money(s.price, s.currency)}</Td>
                  <Td><Badge tone={STATUS[s.status]?.[1] ?? "neutral"}>{STATUS[s.status]?.[0] ?? s.status}</Badge></Td>
                  <Td className="text-right">{s.broker_unit_id && <Link className="text-shadow-700 hover:underline" href={`/inventory/units/${s.broker_unit_id}`}>Open</Link>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
