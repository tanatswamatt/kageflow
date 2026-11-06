import { Badge, Field, Panel, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { dateTime } from "@/lib/format";
import type { WhatsAppMessage } from "@/lib/types";
import { sendCar, sendTemplate, sendWhatsApp } from "@/app/(app)/crm/leads/whatsapp-actions";
import { WhatsAppTemplateForm, type TemplateOption } from "./whatsapp-template-form";

const TICKS: Record<string, string> = { sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed" };

/** The conversation with one lead, with reply, template and send-a-car forms */
export function WhatsAppPanel({ leadId, back, messages, canWrite, connected, phoneDigits, templates, cars, defaultCar, suggestions }: {
  leadId: string;
  back: string;
  messages: WhatsAppMessage[];
  canWrite: boolean;
  connected: boolean;
  phoneDigits: string;
  templates: TemplateOption[];
  cars: { id: string; label: string }[];
  defaultCar: string | null;
  suggestions: string[];
}) {
  const lastIn = [...messages].reverse().find((m) => m.direction === "in");
  const closesAt = lastIn ? new Date(lastIn.created_at).getTime() + 24 * 3600 * 1000 : 0;
  const windowOpen = closesAt > Date.now();
  const hoursLeft = Math.max(0, Math.floor((closesAt - Date.now()) / 3600000));

  return (
    <Panel
      title={<span className="flex items-center gap-2">WhatsApp {connected && (windowOpen ? <Badge tone="jade">Free replies for {hoursLeft < 1 ? "under an hour" : `${hoursLeft} h`}</Badge> : <Badge tone="amber">Template needed</Badge>)}</span>}
      action={phoneDigits.length >= 9 && <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-jade-700 hover:underline">Open in WhatsApp</a>}
    >
      {messages.length === 0 ? (
        <p className="text-sm text-ink-soft">{connected ? "No WhatsApp messages yet. Start with an approved template below." : "No WhatsApp messages yet. Open in WhatsApp to message them from your phone, or connect your business number under Settings, Listings and leads."}</p>
      ) : (
        <ol className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
          {messages.map((m) => {
            const media = m.direction === "in" && m.media_id ? `/api/wa-media/${m.id}` : m.media_link;
            const isImage = (m.msg_type === "image" || m.msg_type === "sticker") && media;
            return (
              <li key={m.id} className={`max-w-[85%] rounded-[var(--radius-control)] px-3 py-2 text-sm ${m.direction === "in" ? "self-start bg-paper" : "self-end bg-jade-50"}`}>
                {isImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a href={media!} target="_blank" rel="noreferrer"><img src={media!} alt="" loading="lazy" className="mb-1 max-h-56 rounded-[4px] object-cover" /></a>
                )}
                {!isImage && media && m.direction === "in" && (
                  <a href={media} target="_blank" rel="noreferrer" className="mb-1 block font-medium text-shadow-700 hover:underline">
                    {m.msg_type === "audio" ? "Play voice note" : m.msg_type === "video" ? "Play video" : `Open ${m.media_name ?? "document"}`}
                  </a>
                )}
                {m.body && !(isImage && m.body === "[photo]") && !/^\[(image|audio|video|document|sticker)\]$/.test(m.body) && <div className="whitespace-pre-line">{m.body}</div>}
                <div className="mt-0.5 text-[11px] text-ink-faint">
                  {dateTime(m.created_at)}
                  {m.template_name && (m.template_name === "auto-reply" ? " · automatic welcome" : ` · template ${m.template_name.replace(/_/g, " ")}`)}
                  {m.direction === "out" && m.status ? ` · ${TICKS[m.status] ?? m.status}` : ""}
                  {m.error && <span className="text-ember-700"> · {m.error}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {canWrite && connected && (
        <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
          {windowOpen ? (
            <>
              <form action={sendWhatsApp} className="flex flex-col gap-2">
                <input type="hidden" name="lead_id" value={leadId} />
                <input type="hidden" name="back" value={back} />
                <Textarea name="body" rows={2} required placeholder="Reply on WhatsApp" />
                <div><SubmitButton size="sm" pendingText="Sending…">Send</SubmitButton></div>
              </form>
              {cars.length > 0 && (
                <form action={sendCar} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="lead_id" value={leadId} />
                  <input type="hidden" name="back" value={back} />
                  <Field label="Send a car: photos, price and details" className="min-w-0 flex-1">
                    <Select name="unit_id" defaultValue={defaultCar ?? cars[0]?.id}>
                      {cars.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </Select>
                  </Field>
                  <SubmitButton size="sm" tone="secondary" pendingText="Sending…">Send car</SubmitButton>
                </form>
              )}
            </>
          ) : (
            <p className="text-[13px] text-ink-soft">
              {lastIn ? "Their last message was over 24 hours ago." : "They haven't messaged you on WhatsApp yet."} WhatsApp only lets businesses start a conversation with an approved template. Once they reply, you can chat and send cars freely for 24 hours.
            </p>
          )}
          {templates.length > 0 ? (
            <details open={!windowOpen}>
              <summary className="cursor-pointer text-[13px] font-medium text-shadow-700">Send a template</summary>
              <div className="mt-3"><WhatsAppTemplateForm templates={templates} leadId={leadId} back={back} suggestions={suggestions} action={sendTemplate} /></div>
            </details>
          ) : !windowOpen && (
            <p className="text-[13px] text-ink-faint">No approved templates yet. An admin creates them in Meta&apos;s WhatsApp Manager, then loads them under Settings, Listings and leads.</p>
          )}
        </div>
      )}
    </Panel>
  );
}
