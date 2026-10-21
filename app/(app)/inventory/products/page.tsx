import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Empty, Input, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import type { Product } from "@/lib/types";

export const metadata: Metadata = { title: "Products" };

const TRACK = { stock: "Counted", none: "Service", serial: "By VIN" } as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; low?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const q = sp.q?.trim();
  let query = ctx.supabase.from("products").select("*").eq("company_id", ctx.companyId).order("name").limit(1000);
  if (q) {
    const t = `*${q.replace(/[*%,()]/g, " ")}*`;
    query = query.or(`name.ilike.${t},sku.ilike.${t}`);
  }
  const { data } = await query;
  let products = (data ?? []) as Product[];
  const low = (p: Product) => p.tracking === "stock" && Number(p.qty_on_hand) <= Number(p.reorder_level ?? 0);
  if (sp.low === "1") products = products.filter(low);
  const base = ctx.company.base_currency;
  const stockValue = products.filter((p) => p.tracking === "stock").reduce((s, p) => s + Number(p.qty_on_hand) * Number(p.avg_cost), 0);

  return (
    <>
      <PageHeader
        title="Products and services"
        description={<>Everything you sell besides individual vehicles. Stock on hand at cost: <strong className="font-semibold text-ink">{money(stockValue, base)}</strong></>}
        actions={ctx.can("inventory.write") && <ButtonLink href="/inventory/products/new" tone="primary">Add product</ButtonLink>}
      />
      <Notice params={sp} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1">
          <Link href="/inventory/products" className={`rounded-full px-3 py-1 text-[13px] ${sp.low !== "1" ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>All</Link>
          <Link href="/inventory/products?low=1" className={`rounded-full px-3 py-1 text-[13px] ${sp.low === "1" ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>Low stock</Link>
        </nav>
        <form className="w-full sm:w-72"><Input name="q" type="search" defaultValue={q} placeholder="Search name or code" aria-label="Search products" /></form>
      </div>
      <Panel flush>
        {products.length === 0 ? (
          <Empty title={q ? "No products match" : "No products yet"}>Add parts, accessories, services and fees here, or create them straight from an invoice line.</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Product</Th><Th>Type</Th><Th className="text-right">In stock</Th><Th className="text-right">Avg cost</Th><Th className="text-right">Price</Th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={`hover:bg-paper ${p.is_active ? "" : "text-ink-faint"}`}>
                  <Td>
                    <div className="flex items-center gap-3">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image_url} alt="" className="size-9 rounded object-cover" />
                      ) : null}
                      <div>
                        <Link href={`/inventory/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                        <div className="font-mono text-[11px] text-ink-faint">{p.sku}</div>
                      </div>
                    </div>
                  </Td>
                  <Td><Badge tone={p.tracking === "stock" ? "shadow" : "neutral"}>{TRACK[p.tracking]}</Badge>{!p.is_active && <> <Badge>Inactive</Badge></>}</Td>
                  <Td className="num">{p.tracking === "stock" ? <span className={low(p) ? "font-semibold text-ember-700" : ""}>{Number(p.qty_on_hand)} {p.unit_label ?? ""}</span> : ""}</Td>
                  <Td className="num">{p.tracking === "stock" && Number(p.avg_cost) ? money(p.avg_cost, base) : ""}</Td>
                  <Td className="num">{p.sale_price != null ? money(p.sale_price, p.currency) : ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
