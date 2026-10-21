import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Dl, Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ProductFields } from "@/components/inventory/product-fields";
import { getContext } from "@/lib/context";
import { date, label, money, today } from "@/lib/format";
import type { Product, TaxRate } from "@/lib/types";
import { countStock, receiveStock, saveProduct } from "../../actions";

export const metadata: Metadata = { title: "Product" };

type Move = { id: string; kind: string; qty: number; unit_cost: number; reference: string | null; doc_id: string | null; journal_id: string | null; created_at: string; sales_docs: { number: string | null } | null };

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("products").select("*").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const p = data as Product;
  const base = ctx.company.base_currency;
  const [{ data: taxes }, { data: moves }, { data: accounts }] = await Promise.all([
    ctx.supabase.from("tax_rates").select("*").eq("company_id", ctx.companyId).eq("is_active", true).order("rate", { ascending: false }),
    ctx.supabase.from("stock_movements").select("*, sales_docs(number)").eq("product_id", id).order("created_at", { ascending: false }).limit(100),
    ctx.supabase.from("accounts").select("id, code, name, system_key").eq("company_id", ctx.companyId).in("type", ["asset", "liability"]).eq("is_active", true).order("code"),
  ]);
  const stock = p.tracking === "stock";
  const canCost = ctx.can("inventory.costs");
  const accts = (accounts ?? []) as { id: string; code: string; name: string; system_key: string | null }[];

  return (
    <>
      <PageHeader
        title={p.name}
        description={<span className="font-mono text-[13px]">{p.sku}</span>}
        back={{ href: "/inventory/products", label: "Products" }}
        actions={stock ? <Badge tone={Number(p.qty_on_hand) <= Number(p.reorder_level ?? 0) ? "ember" : "jade"}>{Number(p.qty_on_hand)} in stock</Badge> : <Badge>{p.tracking === "serial" ? "Tracked by VIN" : "Not counted"}</Badge>}
      />
      <Notice params={sp} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {stock && canCost && (
            <Panel title="Receive stock">
              <form action={receiveStock} className="grid gap-3 sm:grid-cols-3">
                <input type="hidden" name="product_id" value={id} />
                <Field label="Quantity"><Input name="qty" inputMode="decimal" required /></Field>
                <Field label={`Cost each excl. VAT (${base})`}><Input name="unit_cost" inputMode="decimal" required defaultValue={Number(p.avg_cost) || ""} /></Field>
                <Field label="VAT claimable (total)" hint="Blank if none"><Input name="vat_amount" inputMode="decimal" /></Field>
                <Field label="Paid from or owed on">
                  <Select name="paid_from_account_id" defaultValue={accts.find((a) => a.system_key === "payables")?.id}>
                    {accts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                  </Select>
                </Field>
                <Field label="Date"><Input name="date" type="date" defaultValue={today()} /></Field>
                <Field label="Supplier invoice"><Input name="reference" /></Field>
                <div className="sm:col-span-3"><SubmitButton size="sm">Receive stock</SubmitButton></div>
              </form>
              <p className="mt-3 text-[13px] text-ink-faint">For opening stock at go-live, choose 9999 Suspense or your opening balance account under Paid from.</p>
            </Panel>
          )}

          {stock && (
            <Panel title="Stock history" flush>
              {(moves ?? []).length === 0 ? (
                <p className="px-5 py-4 text-ink-soft">No movements yet.</p>
              ) : (
                <Table>
                  <thead><tr><Th>Date</Th><Th>What</Th><Th>Reference</Th><Th className="text-right">Qty</Th><Th className="text-right">Cost each</Th></tr></thead>
                  <tbody>
                    {((moves ?? []) as Move[]).map((m) => (
                      <tr key={m.id}>
                        <Td className="whitespace-nowrap">{date(m.created_at)}</Td>
                        <Td>{label(m.kind)}</Td>
                        <Td className="text-ink-soft">
                          {m.doc_id ? <Link className="hover:underline" href={`/sales/doc/${m.doc_id}`}>{m.sales_docs?.number ?? "Document"}</Link> : m.reference}
                        </Td>
                        <Td className={`num ${Number(m.qty) < 0 ? "text-ember-700" : "text-jade-700"}`}>{Number(m.qty) > 0 ? "+" : ""}{Number(m.qty)}</Td>
                        <Td className="num">{money(m.unit_cost, base)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>
          )}

          {ctx.can("inventory.write") && (
            <Panel title="Details">
              <form action={saveProduct} className="flex flex-col gap-6">
                <input type="hidden" name="id" value={id} />
                <ProductFields product={p} taxes={(taxes ?? []) as TaxRate[]} base={base} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="is_active" defaultChecked={p.is_active} className="size-4 accent-jade-700" />
                  Active (shown when creating invoices)
                </label>
                <div><SubmitButton size="sm" tone="secondary">Save details</SubmitButton></div>
              </form>
            </Panel>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Panel title="Summary">
            <Dl
              items={[
                ["Price", p.sale_price != null ? money(p.sale_price, p.currency) : "Not set"],
                ...(stock ? ([
                  ["On hand", `${Number(p.qty_on_hand)} ${p.unit_label ?? ""}`],
                  ["Average cost", money(p.avg_cost, base)],
                  ["Stock value", money(Number(p.qty_on_hand) * Number(p.avg_cost), base)],
                ] as [string, string][]) : []),
                ...(p.external_id ? ([["Source", "Synced from your website"]] as [string, string][]) : []),
              ]}
            />
          </Panel>
          {stock && canCost && (
            <Panel title="Stock count">
              <form action={countStock} className="flex flex-col gap-3">
                <input type="hidden" name="product_id" value={id} />
                <Field label="Quantity you counted"><Input name="counted" inputMode="decimal" required /></Field>
                <Field label="Reason"><Input name="reason" placeholder="Monthly count, damaged, found" /></Field>
                <div><SubmitButton size="sm" tone="secondary" confirm="Set stock to the counted quantity? The difference is posted at average cost.">Save count</SubmitButton></div>
              </form>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
