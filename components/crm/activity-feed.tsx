import { completeActivity, deleteActivity } from "@/app/(app)/crm/actions";
import { Badge, Empty } from "@/components/ui";
import { dateTime, label } from "@/lib/format";
import type { Activity } from "@/lib/types";

const typeTone = { call: "shadow", meeting: "shadow", email: "neutral", whatsapp: "jade", task: "amber", note: "neutral", system: "neutral" } as const;

export function ActivityFeed({
  activities,
  names,
  back,
  canWrite,
}: {
  activities: Activity[];
  names: Map<string, string>;
  back: string;
  canWrite: boolean;
}) {
  if (activities.length === 0) {
    return <Empty title="Nothing logged yet">Calls, meetings, notes and stage changes appear here.</Empty>;
  }
  const now = Date.now();
  return (
    <ol className="divide-y divide-line">
      {activities.map((a) => {
        const openTask = a.type === "task" && !a.completed_at;
        const overdue = openTask && a.due_at && new Date(a.due_at).getTime() < now;
        return (
          <li key={a.id} className={`flex gap-3 px-5 py-3 ${a.type === "system" ? "text-ink-soft" : ""}`}>
            <div className="w-20 shrink-0 pt-0.5">
              {a.type === "system" ? (
                <span className="text-xs text-ink-faint">Update</span>
              ) : (
                <Badge tone={overdue ? "ember" : typeTone[a.type]}>{label(a.type)}</Badge>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className={`${a.type === "system" ? "" : "font-medium"} ${a.completed_at && a.type === "task" ? "line-through decoration-ink-faint" : ""}`}>
                {a.subject}
              </div>
              {a.body && <p className="mt-0.5 whitespace-pre-line text-ink-soft">{a.body}</p>}
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-faint">
                <span>{dateTime(a.created_at)}</span>
                {a.owner_id && <span>{names.get(a.owner_id) ?? "Member"}</span>}
                {a.due_at && openTask && <span className={overdue ? "font-medium text-ember-700" : ""}>Due {dateTime(a.due_at)}</span>}
              </div>
            </div>
            {canWrite && a.type !== "system" && (
              <div className="flex shrink-0 items-start gap-1">
                {a.type === "task" && (
                  <form action={completeActivity}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="back" value={back} />
                    {a.completed_at && <input type="hidden" name="reopen" value="true" />}
                    <button className="rounded px-2 py-1 text-xs text-jade-700 hover:bg-jade-50">{a.completed_at ? "Reopen" : "Done"}</button>
                  </form>
                )}
                <form action={deleteActivity}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="back" value={back} />
                  <button className="rounded px-2 py-1 text-xs text-ink-faint hover:bg-ember-50 hover:text-ember-700" aria-label={`Delete ${a.subject}`}>
                    Delete
                  </button>
                </form>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
