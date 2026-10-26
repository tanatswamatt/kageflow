import type { Metadata } from "next";
import Link from "next/link";
import { Empty, Input, PageHeader, Panel } from "@/components/ui";
import { getContext } from "@/lib/context";
import { OBJECT_LABEL, refHref } from "@/lib/ontology";

export const metadata: Metadata = { title: "Search" };

type Hit = { object_type: string; id: string; title: string | null; subtitle: string | null };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const ctx = await getContext();
  const { data, error } = q.length >= 2 ? await ctx.supabase.rpc("search_everything", { p_company: ctx.companyId, p_q: q }) : { data: [], error: null };
  const hits = (data ?? []) as Hit[];
  const types = [...new Set(hits.map((h) => h.object_type))];
  return (
    <>
      <PageHeader title="Search" description="Stock number, VIN, name, phone in any format, email, invoice or bill number." />
      <form className="mb-6 max-w-xl"><Input name="q" type="search" defaultValue={q} autoFocus placeholder="e.g. STK-000014, 082 123 4567, INV-000031" aria-label="Search everything" /></form>
      {error && <p className="mb-4 text-ember-700">{error.message}</p>}
      {q.length >= 2 && hits.length === 0 && <Panel><Empty title={`Nothing found for "${q}"`} /></Panel>}
      <div className="grid gap-6 lg:grid-cols-2">
        {types.map((t) => (
          <Panel key={t} title={`${OBJECT_LABEL[t] ?? t}s`}>
            <ul className="flex flex-col gap-2">
              {hits.filter((h) => h.object_type === t).map((h) => (
                <li key={h.id}>
                  <Link href={refHref(t, h.id) ?? "#"} className="font-medium hover:underline">{h.title || "Untitled"}</Link>
                  {h.subtitle && <div className="text-[13px] text-ink-soft">{h.subtitle}</div>}
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  );
}
