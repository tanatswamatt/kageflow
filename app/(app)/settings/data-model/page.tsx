import type { Metadata } from "next";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { getContext } from "@/lib/context";

export const metadata: Metadata = { title: "Data model" };

type ObjType = { key: string; label: string; plural: string; description: string; source_table: string; url_template: string; properties: { key: string; label: string; sensitivity?: string }[]; position: number };
type LinkType = { key: string; from_type: string; to_type: string; label: string; reverse_label: string; cardinality: string };

const SENS: Record<string, "amber" | "ember" | "shadow"> = { personal: "ember", financial: "amber", commercial: "shadow" };

export default async function DataModelPage() {
  const ctx = await getContext();
  const [{ data: types }, { data: links }] = await Promise.all([
    ctx.supabase.from("ontology_object_types").select("*").order("position"),
    ctx.supabase.from("ontology_link_types").select("*"),
  ]);
  const objects = (types ?? []) as ObjType[];
  const linkList = (links ?? []) as LinkType[];
  const counts = await Promise.all(objects.map(async (o) => {
    if (o.source_table === "company_members") return [o.key, null] as const;
    const { count } = await ctx.supabase.from(o.source_table).select("*", { count: "exact", head: true }).eq("company_id", ctx.companyId);
    return [o.key, count] as const;
  }));
  const countOf = new Map(counts);
  const label = new Map(objects.map((o) => [o.key, o.label]));

  return (
    <>
      <PageHeader title="Data model" description="The business objects Kageflow keeps for your dealership and how they connect. Every screen, timeline, search and report reads from this one model, so nothing lives in a separate silo." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="grid gap-4 sm:grid-cols-2">
          {objects.map((o) => (
            <Panel key={o.key} title={<span className="flex items-center gap-2">{o.plural}{countOf.get(o.key) != null && <Badge>{countOf.get(o.key)}</Badge>}</span>}>
              <p className="mb-3 text-[13px] text-ink-soft">{o.description}</p>
              <div className="flex flex-wrap gap-1">
                {o.properties.map((p) => <span key={p.key} className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[12px]">{p.label}{p.sensitivity && <Badge tone={SENS[p.sensitivity] ?? "neutral"}>{p.sensitivity}</Badge>}</span>)}
              </div>
              <ul className="mt-3 flex flex-col gap-1 text-[12px] text-ink-faint">
                {linkList.filter((l) => l.from_type === o.key).map((l) => <li key={l.key}>{o.label} <span className="text-ink-soft">{l.label}</span> {label.get(l.to_type)}</li>)}
                {linkList.filter((l) => l.to_type === o.key).map((l) => <li key={`r-${l.key}`}>{o.label} <span className="text-ink-soft">{l.reverse_label}</span> ({label.get(l.from_type)})</li>)}
              </ul>
            </Panel>
          ))}
        </div>
        <Panel title="How it stays private">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-ink-soft">
            <li>Every object belongs to one company. Other companies can never read it.</li>
            <li><Badge tone="ember">personal</Badge> fields (ID numbers, income, phone numbers, messages) follow {ctx.rules.privacyLaw}. Finance applications are hidden from viewers.</li>
            <li><Badge tone="amber">financial</Badge> fields (costs, the books) are limited to owners, admins and accountants where it matters.</li>
            <li>Timelines and search read through the same rules, so nobody sees more there than on the record itself.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
