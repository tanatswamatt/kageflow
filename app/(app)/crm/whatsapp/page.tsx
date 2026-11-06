import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Empty, Notice, PageHeader, Panel } from "@/components/ui";
import { WhatsAppPanel } from "@/components/crm/whatsapp-panel";
import { getContext } from "@/lib/context";
import { waDigits } from "@/lib/country";
import { getMembers } from "@/lib/members";
import { dateTime } from "@/lib/format";
import { whatsAppPanelData } from "@/lib/whatsapp-data";
import type { Lead } from "@/lib/types";

export const metadata: Metadata = { title: "WhatsApp" };

type Conv = { lead_id: string; name: string; wa_id: string; last_body: string | null; last_at: string; last_direction: "in" | "out"; unread: number; last_inbound: string | null; owner_id: string | null; lead_status: string; unit_id: string | null };

export default async function WhatsAppInbox({ searchParams }: { searchParams: Promise<{ lead?: string; v?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const [{ data }, members] = await Promise.all([ctx.supabase.rpc("whatsapp_conversations", { p_company: ctx.companyId, p_limit: 200 }), getMembers()]);
  const all = (data ?? []) as Conv[];
  const waiting = all.filter((c) => c.unread > 0);
  const view = sp.v === "all" ? "all" : "waiting";
  const list = view === "all" ? all : waiting;
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const selectedId = sp.lead ?? list[0]?.lead_id ?? null;

  let panel: React.ReactNode = null;
  if (selectedId) {
    const { data: ld } = await ctx.supabase.from("crm_leads").select("*").eq("id", selectedId).eq("company_id", ctx.companyId).maybeSingle();
    const lead = ld as Lead | null;
    if (lead) {
      const wa = await whatsAppPanelData(ctx, lead);
      const back = `/crm/whatsapp?lead=${lead.id}${view === "all" ? "&v=all" : ""}`;
      panel = (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[17px] font-semibold">{[lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.company_name || lead.phone}</div>
            <ButtonLink href={`/crm/leads/${lead.id}`} size="sm">Open lead</ButtonLink>
          </div>
          <WhatsAppPanel leadId={lead.id} back={back} canWrite={ctx.can("crm.write")} phoneDigits={waDigits(lead.phone, ctx.rules)} {...wa} />
        </div>
      );
    }
  }

  const tab = (v: "waiting" | "all", text: string) => (
    <Link href={v === "all" ? "/crm/whatsapp?v=all" : "/crm/whatsapp"} className={`rounded-[var(--radius-control)] px-3 py-1.5 text-sm ${view === v ? "bg-shadow-800 font-medium text-white" : "text-ink-soft hover:bg-paper"}`}>{text}</Link>
  );

  return (
    <>
      <PageHeader title="WhatsApp" description="Every WhatsApp conversation with your business number, newest first. Reply, send a car, or use a template once 24 hours have passed." />
      <Notice params={sp} />
      <div className="mb-4 flex gap-1">{tab("waiting", `Waiting for a reply (${waiting.length})`)}{tab("all", `All (${all.length})`)}</div>
      {list.length === 0 ? (
        <Panel><Empty title={view === "waiting" ? "Nobody is waiting" : "No WhatsApp conversations yet"}>{view === "waiting" ? "Every customer has had a reply." : "Connect your business number under Settings, Listings and leads. Messages arrive here and as leads."}</Empty></Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <Panel flush>
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {list.map((c) => {
                const open = !!c.last_inbound && Date.now() - new Date(c.last_inbound).getTime() < 24 * 3600 * 1000;
                const active = c.lead_id === selectedId;
                return (
                  <li key={c.lead_id}>
                    <Link href={`/crm/whatsapp?lead=${c.lead_id}${view === "all" ? "&v=all" : ""}`} className={`block px-4 py-3 ${active ? "bg-shadow-100" : "hover:bg-paper"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="shrink-0 text-[12px] text-ink-faint">{dateTime(c.last_at)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] text-ink-soft">{c.last_direction === "out" ? "You: " : ""}{c.last_body}</span>
                        {c.unread > 0 && <span className="grid size-5 shrink-0 place-items-center rounded-full bg-jade-700 text-[11px] font-semibold text-white">{c.unread}</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-faint">
                        {open ? <Badge tone="jade">Can reply</Badge> : <Badge tone="amber">Template needed</Badge>}
                        <span className="truncate">{c.owner_id ? names.get(c.owner_id) ?? "" : "Unassigned"}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
          {panel ?? <Panel><p className="text-ink-soft">Choose a conversation.</p></Panel>}
        </div>
      )}
    </>
  );
}
