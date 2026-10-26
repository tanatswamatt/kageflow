import Link from "next/link";
import { money } from "@/lib/format";
import { EVENT_KINDS, refHref, type ObjectEvent } from "@/lib/ontology";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });

/** One history across every department for a vehicle or a customer, newest first, with filters by kind */
export function Timeline({ events, basePath, active, hideAmounts = false }: { events: ObjectEvent[]; basePath: string; active?: string; hideAmounts?: boolean }) {
  const kinds = [...new Set(events.map((e) => e.kind))];
  const shown = active ? events.filter((e) => e.kind === active) : events;
  const groups: { day: string; items: ObjectEvent[] }[] = [];
  for (const e of shown) {
    const d = day(e.at);
    const g = groups[groups.length - 1];
    if (g && g.day === d) g.items.push(e);
    else groups.push({ day: d, items: [e] });
  }
  const sep = basePath.includes("?") ? "&" : "?";
  return (
    <div className="flex flex-col gap-4">
      {kinds.length > 1 && (
        <nav className="flex flex-wrap gap-1" aria-label="Filter history">
          <Link href={basePath} scroll={false} className={`rounded-full px-2.5 py-0.5 text-[12px] ${!active ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>All {events.length}</Link>
          {kinds.map((k) => (
            <Link key={k} href={`${basePath}${sep}h=${k}`} scroll={false} className={`rounded-full px-2.5 py-0.5 text-[12px] ${active === k ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>
              {EVENT_KINDS[k]?.label ?? k} {events.filter((e) => e.kind === k).length}
            </Link>
          ))}
        </nav>
      )}
      {groups.length === 0 && <p className="text-sm text-ink-soft">Nothing yet.</p>}
      <ol className="flex flex-col gap-4">
        {groups.map((g) => (
          <li key={g.day}>
            <div className="mb-1.5 text-xs font-semibold text-ink-faint">{g.day}</div>
            <ol className="relative flex flex-col gap-2.5 border-l border-line pl-4">
              {g.items.map((e, i) => {
                const href = refHref(e.ref_type, e.ref_id);
                return (
                  <li key={`${e.kind}-${e.ref_id}-${i}`} className="relative">
                    <span className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-2 ring-surface ${EVENT_KINDS[e.kind]?.dot ?? "bg-ink-faint"}`} aria-hidden="true" />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm">{href ? <Link className="font-medium hover:underline" href={href}>{e.title}</Link> : <span className="font-medium">{e.title}</span>}</span>
                      <span className="text-xs whitespace-nowrap text-ink-faint">{!hideAmounts && e.amount != null && Number(e.amount) !== 0 ? <span className="mr-2 text-ink-soft tabular-nums">{money(e.amount, e.currency ?? "ZAR")}</span> : null}{time(e.at)}</span>
                    </div>
                    {e.detail && <div className="text-[13px] whitespace-pre-line text-ink-soft">{e.detail}</div>}
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  );
}
