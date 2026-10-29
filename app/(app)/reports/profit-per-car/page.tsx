import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Empty, Input, PageHeader, Panel, Select, Stat, Table, Td, Th } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { getContext } from "@/lib/context";
import { getMembers } from "@/lib/members";
import { date, moneyFor } from "@/lib/format";
import { month, taxYear, validDate } from "@/lib/periods";
import { ageTone, askingNet, netProfit, type VehicleProfit } from "@/lib/profit";

export const metadata: Metadata = { title: "Profit per car" };

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "");

export default async function ProfitPerCarPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string; who?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);
  if (!ctx.can("ledger.write")) return <Panel><p className="text-ink-soft">Profit per car is for owners, admins and accountants.</p></Panel>;
  const tab = sp.tab === "stock" ? "stock" : "sold";
  const def = month();
  const from = validDate(sp.from) ? sp.from : def.from;
  const to = validDate(sp.to) ? sp.to : def.to;
  const vatVendor = !!ctx.company.vat_no?.trim();
  const members = await getMembers();
  const names = new Map(members.map((m) => [m.user_id, m.name]));

  let q = ctx.supabase.from("vehicle_profit").select("*").eq("company_id", ctx.companyId);
  q = tab === "sold" ? q.eq("status", "sold").gte("sold_on", from).lte("sold_on", to).order("sold_on", { ascending: false }) : q.in("status", ["in_stock", "reserved", "in_transit", "on_order"]).order("days_in_stock", { ascending: false });
  if (tab === "sold" && sp.who) q = q.eq("salesperson_id", sp.who);
  const { data, error } = await q.limit(2000);
  const rows = (data ?? []) as VehicleProfit[];

  const head = (
    <nav className="mb-4 flex flex-wrap items-center gap-1 print:hidden">
      <Link href="/reports/profit-per-car" className={`rounded-full px-3 py-1 text-[13px] ${tab === "sold" ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>Sold</Link>
      <Link href="/reports/profit-per-car?tab=stock" className={`rounded-full px-3 py-1 text-[13px] ${tab === "stock" ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>In stock</Link>
    </nav>
  );

  if (tab === "stock") {
    const value = rows.reduce((s, r) => s + Number(r.landed_cost), 0);
    const projected = rows.map((r) => ({ r, ask: askingNet(r, vatVendor, ctx.company.base_currency, ctx.rules.vatRate) })).map(({ r, ask }) => ({ r, ask, gross: ask !== null ? ask - Number(r.landed_cost) : null }));
    const old = rows.filter((r) => r.days_in_stock > 90).length;
    const avgDays = rows.length ? Math.round(rows.reduce((s, r) => s + r.days_in_stock, 0) / rows.length) : 0;
    return (
      <>
        <PageHeader title="Profit per car" description="Cars in stock: what they cost you, what they should make at the asking price, and how long they've been standing." actions={<div className="print:hidden"><PrintButton /></div>} />
        {head}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Cars in stock" value={String(rows.length)} />
          <Stat label="Stock at cost" value={money(value)} />
          <Stat label="Average days in stock" value={String(avgDays)} />
          <Stat label="Over 90 days" value={String(old)} sub={old ? "Price them to move" : undefined} />
        </div>
        <Panel flush>
          {rows.length === 0 ? <Empty title="No cars in stock" /> : (
            <Table>
              <thead><tr><Th>Car</Th><Th className="text-right">Days</Th><Th className="text-right">Bought</Th><Th className="text-right">Recon</Th><Th className="text-right">Other</Th><Th className="text-right">Landed</Th><Th className="text-right">Asking excl. VAT</Th><Th className="text-right">Expected gross</Th></tr></thead>
              <tbody>
                {projected.map(({ r, ask, gross }) => (
                  <tr key={r.unit_id} className="hover:bg-paper">
                    <Td><Link href={`/inventory/units/${r.unit_id}`} className="font-medium hover:underline">{[r.year, r.make, r.model].filter(Boolean).join(" ")}</Link><div className="text-xs text-ink-faint">{r.stock_no}{r.status !== "in_stock" ? ` · ${r.status.replace(/_/g, " ")}` : ""}</div></Td>
                    <Td className="text-right"><Badge tone={ageTone(r.days_in_stock)}>{r.days_in_stock}</Badge></Td>
                    <Td className="num">{money(r.purchase_cost)}</Td>
                    <Td className="num">{Number(r.recon_cost) ? money(r.recon_cost) : ""}</Td>
                    <Td className="num">{Number(r.other_costs) ? money(r.other_costs) : ""}</Td>
                    <Td className="num font-medium">{money(r.landed_cost)}</Td>
                    <Td className="num">{ask !== null ? money(ask) : <span className="text-ink-faint">No price</span>}</Td>
                    <Td className={`num font-semibold ${gross !== null && gross < 0 ? "text-ember-700" : ""}`}>{gross !== null ? `${money(gross)} ${ask ? `(${pct(gross, ask)})` : ""}` : ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        {error && <p className="mt-3 text-ember-700">{error.message}</p>}
      </>
    );
  }

  const t = rows.reduce((s, r) => ({
    sale: s.sale + Number(r.sale_net ?? 0), gross: s.gross + Number(r.gross_profit ?? 0), addon: s.addon + Number(r.addon_profit ?? 0),
    fi: s.fi + Number(r.finance_income ?? 0), comm: s.comm + Number(r.commission ?? 0), net: s.net + netProfit(r), days: s.days + r.days_in_stock,
  }), { sale: 0, gross: 0, addon: 0, fi: 0, comm: 0, net: 0, days: 0 });
  const presets = [["This month", month()], ["Last month", month(-1)], ["This tax year", taxYear(0, ctx.rules.taxYearStart)]] as const;

  return (
    <>
      <PageHeader title="Profit per car" description={`Cars sold ${date(from)} to ${date(to)}. Amounts exclude VAT.`} actions={<div className="print:hidden"><PrintButton /></div>} />
      {head}
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <nav className="flex flex-wrap gap-1">
          {presets.map(([l, p]) => <Link key={l} href={`?from=${p.from}&to=${p.to}${sp.who ? `&who=${sp.who}` : ""}`} className={`rounded-full px-3 py-1 text-[13px] ${p.from === from && p.to === to ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>{l}</Link>)}
        </nav>
        <form className="ml-auto flex flex-wrap items-center gap-2">
          <Select name="who" defaultValue={sp.who ?? ""} className="w-44" aria-label="Salesperson"><option value="">All salespeople</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</Select>
          <Input type="date" name="from" defaultValue={from} aria-label="From" className="w-40" />
          <Input type="date" name="to" defaultValue={to} aria-label="To" className="w-40" />
          <Button type="submit" size="sm">Update</Button>
        </form>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cars sold" value={String(rows.length)} />
        <Stat label="Net profit" value={money(t.net)} sub={pct(t.net, t.sale) ? `${pct(t.net, t.sale)} of sales` : undefined} />
        <Stat label="Average net per car" value={rows.length ? money(t.net / rows.length) : "-"} />
        <Stat label="Average days to sell" value={rows.length ? String(Math.round(t.days / rows.length)) : "-"} />
      </div>
      <Panel flush>
        {rows.length === 0 ? <Empty title="No cars sold in this period" /> : (
          <Table>
            <thead><tr><Th>Car</Th><Th>Sold</Th><Th className="text-right">Days</Th><Th>Salesperson</Th><Th className="text-right">Sale</Th><Th className="text-right">Landed cost</Th><Th className="text-right">Gross</Th><Th className="text-right">Add-ons</Th><Th className="text-right">F&amp;I</Th><Th className="text-right">Commission</Th><Th className="text-right">Net profit</Th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const net = netProfit(r);
                return (
                  <tr key={r.unit_id} className="hover:bg-paper">
                    <Td><Link href={`/inventory/units/${r.unit_id}`} className="font-medium hover:underline">{[r.year, r.make, r.model].filter(Boolean).join(" ")}</Link><div className="text-xs text-ink-faint">{r.stock_no} · <Link className="hover:underline" href={`/sales/doc/${r.invoice_id}`}>{r.invoice_number}</Link></div></Td>
                    <Td className="whitespace-nowrap text-ink-soft">{date(r.sold_on)}</Td>
                    <Td className="num">{r.days_in_stock}</Td>
                    <Td className="text-ink-soft">{r.salesperson_id ? names.get(r.salesperson_id) ?? "" : ""}</Td>
                    <Td className="num">{money(r.sale_net)}</Td>
                    <Td className="num">{money(r.cogs ?? r.landed_cost)}{Number(r.recon_cost) > 0 && <div className="text-xs text-ink-faint">incl. recon {money(r.recon_cost)}</div>}</Td>
                    <Td className={`num ${Number(r.gross_profit) < 0 ? "text-ember-700" : ""}`}>{money(r.gross_profit)}</Td>
                    <Td className="num">{Number(r.addon_profit) ? money(r.addon_profit) : ""}</Td>
                    <Td className="num">{Number(r.finance_income) ? money(r.finance_income) : ""}</Td>
                    <Td className="num">{Number(r.commission) ? `-${money(r.commission)}` : ""}</Td>
                    <Td className={`num font-semibold ${net < 0 ? "text-ember-700" : ""}`}>{money(net)}<div className="text-xs font-normal text-ink-faint">{pct(net, Number(r.sale_net))}</div></Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="px-4 py-3" colSpan={4}>Total</td>
                <td className="num px-4 py-3">{money(t.sale)}</td><td className="num px-4 py-3">{money(t.sale - t.gross)}</td><td className="num px-4 py-3">{money(t.gross)}</td>
                <td className="num px-4 py-3">{money(t.addon)}</td><td className="num px-4 py-3">{money(t.fi)}</td><td className="num px-4 py-3">-{money(t.comm)}</td><td className="num px-4 py-3">{money(t.net)}</td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Panel>
      <p className="mt-3 text-[13px] text-ink-faint">Add-ons are profit on other lines of the same invoice (tow bars, warranties). F&amp;I is the finance house commission (DIC) recorded on the bank&apos;s payout. Commission is the salesperson&apos;s, approved or pending.</p>
      {error && <p className="mt-3 text-ember-700">{error.message}</p>}
    </>
  );
}
