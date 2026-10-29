import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Empty, Input, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { label, moneyFor } from "@/lib/format";
import { unitTone } from "@/lib/badges";
import type { Unit } from "@/lib/types";

export const metadata: Metadata = { title: "Vehicles" };

const VIEWS = [
  { key: "available", label: "Available", statuses: ["on_order", "listed", "in_transit", "in_stock", "reserved"] },
  { key: "in_stock", label: "In stock", statuses: ["in_stock"] },
  { key: "listed", label: "Supplier listings", statuses: ["listed"] },
  { key: "in_transit", label: "In transit", statuses: ["in_transit", "on_order"] },
  { key: "reserved", label: "Reserved", statuses: ["reserved"] },
  { key: "sold", label: "Sold", statuses: ["sold"] },
];

export default async function UnitsPage({ searchParams }: { searchParams: Promise<{ v?: string; q?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);
  const view = VIEWS.find((v) => v.key === sp.v) ?? VIEWS[0]!;
  const q = sp.q?.trim();
  let query = ctx.supabase.from("inventory_units").select("*").eq("company_id", ctx.companyId).in("status", view.statuses).order("created_at", { ascending: false }).limit(500);
  if (q) {
    const t = `*${q.replace(/[*%,()]/g, " ")}*`;
    query = query.or(`serial_no.ilike.${t},make.ilike.${t},model.ilike.${t},stock_no.ilike.${t}`);
  }
  const seeCost = ctx.can("inventory.costs");
  const [{ data }, { data: values }] = await Promise.all([query, ctx.supabase.from("unit_values").select("unit_id, landed_cost").eq("company_id", ctx.companyId)]);
  const units = (data ?? []) as Unit[];
  const cost = new Map(((values ?? []) as { unit_id: string; landed_cost: number }[]).map((v) => [v.unit_id, Number(v.landed_cost)]));
  const base = ctx.company.base_currency;
  const stockValue = units.filter((u) => u.status !== "sold").reduce((s, u) => s + (cost.get(u.id) ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Vehicles"
        description={!seeCost ? (view.key !== "sold" ? "Vehicles in stock and on the way." : "Vehicles sold.") : view.key !== "sold" ? <>Landed cost of vehicles in this view: <strong className="font-semibold text-ink">{money(stockValue, base)}</strong></> : "Vehicles sold, with the invoice that sold them."}
        actions={ctx.can("inventory.write") && (
          <>
            <ButtonLink href="/inventory/stock-check">Stock check</ButtonLink>
            <ButtonLink href="/inventory/list-supplier-car">List a supplier&apos;s car</ButtonLink>
            <ButtonLink href="/inventory/units/new">Full form</ButtonLink>
            <ButtonLink href="/inventory/quick-add" tone="primary">Add a car</ButtonLink>
          </>
        )}
      />
      <Notice params={sp} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <Link key={v.key} href={`/inventory/units?v=${v.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`rounded-full px-3 py-1 text-[13px] ${v.key === view.key ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>{v.label}</Link>
          ))}
        </nav>
        <form className="w-full sm:w-72">
          <input type="hidden" name="v" value={view.key} />
          <Input name="q" type="search" defaultValue={q} placeholder="Search stock no, VIN, make, model" aria-label="Search vehicles" />
        </form>
      </div>
      <Panel flush>
        {units.length === 0 ? (
          <Empty title="No vehicles here">Add a vehicle, then post its purchase, transport and duty costs.</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Vehicle</Th><Th>VIN</Th><Th>Location</Th><Th>Status</Th>{seeCost && <Th className="text-right">Landed cost ({base})</Th>}<Th className="text-right">Asking</Th></tr></thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id} className="hover:bg-paper">
                  <Td>
                    <div className="flex items-center gap-3">
                      {u.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.image_url} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />
                      ) : (
                        <span className="h-10 w-14 shrink-0 rounded bg-paper" aria-hidden="true" />
                      )}
                      <div>
                        <Link href={`/inventory/units/${u.id}`} className="font-medium hover:underline">{[u.make, u.model, u.year].filter(Boolean).join(" ") || "Unnamed unit"}</Link>
                        <div className="text-xs text-ink-faint">{[u.stock_no, u.variant, u.external_id ? "From website" : null].filter(Boolean).join(" · ")}{u.is_published && <span className="ml-1.5 rounded bg-jade-50 px-1.5 py-px font-medium text-jade-700">Advertised</span>}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="font-mono text-[12px]">{u.vin_confirmed ? u.serial_no : <Badge tone="amber">VIN needed</Badge>}</Td>
                  <Td className="text-ink-soft">{u.location}</Td>
                  <Td><Badge tone={unitTone[u.status]}>{label(u.status)}</Badge></Td>
                  {seeCost && <Td className="num">{cost.get(u.id) ? money(cost.get(u.id)!, base) : <span className="text-amber-700">No costs</span>}</Td>}
                  <Td className="num">{u.list_price != null ? money(u.list_price, u.list_currency) : ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
