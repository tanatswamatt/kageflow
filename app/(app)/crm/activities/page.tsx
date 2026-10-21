import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { ActivityFeed } from "@/components/crm/activity-feed";
import { getContext } from "@/lib/context";
import { memberNames } from "@/lib/members";
import type { Activity } from "@/lib/types";

export const metadata: Metadata = { title: "Activities" };

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<{ who?: string; error?: string; ok?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const mine = params.who !== "all";

  let tasks = ctx.supabase
    .from("crm_activities")
    .select("*")
    .eq("company_id", ctx.companyId)
    .eq("type", "task")
    .is("completed_at", null)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);
  let recent = ctx.supabase
    .from("crm_activities")
    .select("*")
    .eq("company_id", ctx.companyId)
    .neq("type", "system")
    .not("completed_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (mine) {
    tasks = tasks.eq("owner_id", ctx.user.id);
    recent = recent.eq("owner_id", ctx.user.id);
  }
  const [{ data: open }, { data: done }, names] = await Promise.all([tasks, recent, memberNames()]);
  const canWrite = ctx.can("crm.write");
  const back = `/crm/activities${mine ? "" : "?who=all"}`;

  return (
    <>
      <PageHeader
        title="Activities"
        description="Follow-ups due, and what the team has logged recently. Log new activities from a lead, deal, account or contact."
        actions={
          <nav className="flex gap-1">
            {[["mine", "Mine"], ["all", "Everyone"]].map(([k, l]) => (
              <Link key={k} href={k === "mine" ? "/crm/activities" : "/crm/activities?who=all"} className={`rounded-full px-3 py-1 text-[13px] ${(k === "mine") === mine ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>
                {l}
              </Link>
            ))}
          </nav>
        }
      />
      <Notice params={params} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Open tasks" flush className="self-start">
          <ActivityFeed activities={(open ?? []) as Activity[]} names={names} back={back} canWrite={canWrite} />
        </Panel>
        <Panel title="Recently logged" flush className="self-start">
          <ActivityFeed activities={(done ?? []) as Activity[]} names={names} back={back} canWrite={canWrite} />
        </Panel>
      </div>
    </>
  );
}
