import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Empty, Field, Input, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { dateTime } from "@/lib/format";
import { startCheck } from "./actions";

export const metadata: Metadata = { title: "Stock checks" };

type C = { id: string; name: string; location: string | null; status: string; started_at: string; expected: number | null; found: number | null; missing: number | null; unknown: number | null };

export default async function StockChecksPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("stock_checks").select("*").eq("company_id", ctx.companyId).order("started_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as C[];
  return (
    <>
      <PageHeader title="Stock checks" description="Walk the lot with your phone and scan every car. Kageflow shows what's missing and what's there but not recorded." back={{ href: "/inventory/units", label: "Vehicles" }} />
      <Notice params={sp} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Panel flush>
          {rows.length === 0 ? <Empty title="No stock checks yet" /> : (
            <Table>
              <thead><tr><Th>Check</Th><Th>Started</Th><Th className="text-right">Found</Th><Th className="text-right">Missing</Th><Th className="text-right">Not recorded</Th><Th /></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-paper">
                    <Td><Link className="font-medium hover:underline" href={`/inventory/stock-check/${c.id}`}>{c.name}</Link>{c.location && <div className="text-xs text-ink-faint">{c.location}</div>}</Td>
                    <Td className="text-ink-soft">{dateTime(c.started_at)}</Td>
                    <Td className="num">{c.found ?? ""}</Td>
                    <Td className={`num ${c.missing ? "font-semibold text-ember-700" : ""}`}>{c.missing ?? ""}</Td>
                    <Td className="num">{c.unknown ?? ""}</Td>
                    <Td><Badge tone={c.status === "open" ? "amber" : "neutral"}>{c.status === "open" ? "In progress" : "Closed"}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        {ctx.can("inventory.write") && (
          <Panel title="Start a stock check">
            <form action={startCheck} className="flex flex-col gap-3">
              <Field label="Name (optional)"><Input name="name" placeholder="Month-end count" /></Field>
              <Field label="Only one location (optional)" hint="Matches the start of each car's location"><Input name="location" placeholder="Main lot" /></Field>
              <SubmitButton>Start scanning</SubmitButton>
            </form>
          </Panel>
        )}
      </div>
    </>
  );
}
