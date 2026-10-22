import type { Metadata } from "next";
import { headers } from "next/headers";
import { Badge, Field, Input, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { CopyField } from "@/components/copy-field";
import { CreateKeyForm } from "@/components/integrations/create-key-form";
import { getContext } from "@/lib/context";
import { dateTime } from "@/lib/format";
import type { ApiKey, StockSource, WebhookEndpoint } from "@/lib/types";
import { addEndpoint, addStockSource, createKey, removeEndpoint, removeStockSource, revokeKey, syncNow, testEndpoint, toggleEndpoint, toggleStockSource } from "./actions";
import { StockSourceForm } from "@/components/integrations/stock-source-form";

export const metadata: Metadata = { title: "Integrations" };

const EVENTS: [string, string][] = [
  ["order.updated", "Order confirmed, cancelled, fulfilled or its tracking stage changed"],
  ["invoice.issued", "Invoice issued"],
  ["credit_note.issued", "Credit note issued"],
  ["payment.received", "Payment or deposit received"],
  ["unit.updated", "A website vehicle was reserved, sold or returned to stock"],
  ["lead.created", "A new lead arrived from email, WhatsApp or the API"],
];

type Delivery = { id: number; url: string; event: string; created_at: string; status_code: number | null; error_msg: string | null };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("company.manage")) {
    return <Panel><p className="text-ink-soft">Only owners and admins can manage integrations.</p></Panel>;
  }
  const [{ data: keys }, { data: endpoints }, { data: log }, { data: sources }] = await Promise.all([
    ctx.supabase.from("api_keys").select("id, name, prefix, created_at, last_used_at, revoked_at").eq("company_id", ctx.companyId).order("created_at", { ascending: false }),
    ctx.supabase.from("webhook_endpoints").select("*").eq("company_id", ctx.companyId).order("created_at"),
    ctx.supabase.rpc("webhook_delivery_log", { p_company: ctx.companyId, p_limit: 30 }),
    ctx.supabase.from("stock_sources").select("*").eq("company_id", ctx.companyId).order("created_at"),
  ]);
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get("origin") ?? "https://your-kageflow-domain";

  return (
    <>
      <PageHeader title="Integrations" description="Connect your website: send enquiries in as leads, look up order status, and get notified when orders, invoices and payments change." />
      <Notice params={sp} />
      <div className="flex flex-col gap-6">
        <Panel title="Website stock">
          <p className="mb-4 text-ink-soft">Pull the vehicles and products listed on your website into Kageflow, with their photos and prices. Kageflow checks every 15 minutes. Purchase costs stay in Kageflow; the website never sees them.</p>
          {((sources ?? []) as StockSource[]).length > 0 && (
            <ul className="-mx-5 mb-5 divide-y divide-line border-y border-line">
              {((sources ?? []) as StockSource[]).map((src) => (
                <li key={src.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="font-medium">{src.name} <span className="font-mono text-[12px] font-normal text-ink-faint">{src.base_url}</span></div>
                    <div className="text-[13px] text-ink-soft">
                      {src.last_synced_at ? <>Last sync {dateTime(src.last_synced_at)}: {src.last_status === "ok" ? `${src.last_counts?.received ?? 0} listings read, ${src.last_counts?.created ?? 0} new, ${src.last_counts?.updated ?? 0} updated` : <span className="text-ember-700">{src.last_status}</span>}</> : "Not synced yet"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={src.is_active ? "jade" : "neutral"}>{src.is_active ? "Every 15 min" : "Paused"}</Badge>
                    <form action={syncNow}><input type="hidden" name="id" value={src.id} /><SubmitButton size="sm" pendingText="Syncing…">Sync now</SubmitButton></form>
                    <form action={toggleStockSource}><input type="hidden" name="id" value={src.id} /><input type="hidden" name="active" value={String(!src.is_active)} /><SubmitButton size="sm" tone="quiet" pendingText="…">{src.is_active ? "Pause" : "Resume"}</SubmitButton></form>
                    <form action={removeStockSource}><input type="hidden" name="id" value={src.id} /><SubmitButton size="sm" tone="quiet" confirm="Disconnect this website? Imported vehicles stay." pendingText="…">Disconnect</SubmitButton></form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <StockSourceForm action={addStockSource} />
          <p className="mt-4 text-[13px] text-ink-faint">To mark vehicles reserved or sold on the website when that happens in Kageflow, add a webhook below with the <span className="font-mono">unit.updated</span> event.</p>
        </Panel>

        <Panel title="API keys">
          <CreateKeyForm action={createKey} />
          {(keys ?? []).length > 0 && (
            <div className="mt-5 -mx-5 -mb-5 border-t border-line">
              <Table>
                <thead><tr><Th>Name</Th><Th>Key starts</Th><Th>Created</Th><Th>Last used</Th><Th /></tr></thead>
                <tbody>
                  {((keys ?? []) as ApiKey[]).map((k) => (
                    <tr key={k.id} className={k.revoked_at ? "text-ink-faint" : ""}>
                      <Td className="font-medium">{k.name}</Td>
                      <Td className="font-mono text-[12px]">{k.prefix}…</Td>
                      <Td>{dateTime(k.created_at)}</Td>
                      <Td>{k.last_used_at ? dateTime(k.last_used_at) : "Never"}</Td>
                      <Td className="text-right">
                        {k.revoked_at ? <Badge>Revoked</Badge> : (
                          <form action={revokeKey}>
                            <input type="hidden" name="id" value={k.id} />
                            <SubmitButton size="sm" tone="danger" confirm={`Revoke ${k.name}? Anything using it stops working immediately.`} pendingText="…">Revoke</SubmitButton>
                          </form>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Panel>

        <Panel title="Using the API">
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <p className="font-medium">Send a website enquiry in as a lead</p>
              <pre className="mt-2 overflow-x-auto rounded-[var(--radius-control)] bg-shadow-900 p-4 text-[12px] leading-relaxed text-shadow-100">{`POST ${origin}/api/v1/leads
Authorization: Bearer kf_live_...
Content-Type: application/json

{
  "external_ref": "enquiry-1042",      // your form id; resending it never duplicates
  "first_name": "Wanjiru", "last_name": "Kamau",
  "company_name": "Nairobi Fleet Ltd",
  "email": "w@example.com", "phone": "+254 700 000000",
  "interest": "2022 Land Cruiser 79, export to Kenya",
  "estimated_value": 650000, "currency": "ZAR",
  "source": "web_form", "source_detail": "kalaligroup.co.za/inventory",
  "message": "Can you deliver to Nairobi by March?",
  "consent": true, "consent_text": "I agree to be contacted about my enquiry"
}`}</pre>
              <p className="mt-1 text-ink-soft">Returns <code>{`{"id": "...", "status": "created"}`}</code>, or <code>&quot;existing&quot;</code> if that external_ref was already received.</p>
            </div>
            <div>
              <p className="font-medium">Look up an order for your tracker</p>
              <pre className="mt-2 overflow-x-auto rounded-[var(--radius-control)] bg-shadow-900 p-4 text-[12px] text-shadow-100">{`GET ${origin}/api/v1/orders/{SO-000012 or your own order reference}
Authorization: Bearer kf_live_...`}</pre>
              <p className="mt-1 text-ink-soft">Returns status, tracking stage, deposits received and the invoice balance. Put your own order number in the order&apos;s customer reference to look it up by that.</p>
            </div>
          </div>
        </Panel>

        <Panel title="Webhooks">
          {((endpoints ?? []) as WebhookEndpoint[]).length > 0 && (
            <ul className="-mx-5 -mt-5 mb-5 divide-y divide-line border-b border-line">
              {((endpoints ?? []) as WebhookEndpoint[]).map((e) => (
                <li key={e.id} className="flex flex-col gap-3 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[13px]">{e.url}</div>
                      <div className="text-xs text-ink-faint">{e.events.join(", ")}{e.description ? ` · ${e.description}` : ""}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={e.is_active ? "jade" : "neutral"}>{e.is_active ? "Active" : "Paused"}</Badge>
                      <form action={testEndpoint}><input type="hidden" name="id" value={e.id} /><SubmitButton size="sm" tone="secondary" pendingText="…">Send test</SubmitButton></form>
                      <form action={toggleEndpoint}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="active" value={String(!e.is_active)} /><SubmitButton size="sm" tone="quiet" pendingText="…">{e.is_active ? "Pause" : "Resume"}</SubmitButton></form>
                      <form action={removeEndpoint}><input type="hidden" name="id" value={e.id} /><SubmitButton size="sm" tone="quiet" confirm="Remove this webhook?" pendingText="…">Remove</SubmitButton></form>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-ink-faint">Signing secret: verify X-Kageflow-Signature = sha256 HMAC of the raw body</div>
                    <CopyField value={e.secret} secret />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form action={addEndpoint} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Send to (https)"><Input name="url" type="url" required placeholder="https://kalaligroup.co.za/api/kageflow" /></Field>
              <Field label="Description"><Input name="description" placeholder="Kalali order tracker" /></Field>
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[13px] font-medium text-ink-soft">Events</legend>
              {EVENTS.map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="events" value={k} defaultChecked className="size-4 accent-jade-700" />
                  <span className="font-mono text-[12px]">{k}</span> <span className="text-ink-soft">{l}</span>
                </label>
              ))}
            </fieldset>
            <div><SubmitButton size="sm">Add webhook</SubmitButton></div>
          </form>
        </Panel>

        {((log ?? []) as Delivery[]).length > 0 && (
          <Panel title="Recent deliveries" flush>
            <Table>
              <thead><tr><Th>When</Th><Th>Event</Th><Th>To</Th><Th>Result</Th></tr></thead>
              <tbody>
                {((log ?? []) as Delivery[]).map((d) => (
                  <tr key={d.id}>
                    <Td className="whitespace-nowrap">{dateTime(d.created_at)}</Td>
                    <Td className="font-mono text-[12px]">{d.event}</Td>
                    <Td className="max-w-64 truncate font-mono text-[12px]">{d.url}</Td>
                    <Td>
                      {d.status_code ? <Badge tone={d.status_code < 300 ? "jade" : "ember"}>{d.status_code}</Badge> : d.error_msg ? <span className="text-ember-700">{d.error_msg}</span> : <span className="text-ink-faint">Pending or expired</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        )}
      </div>
    </>
  );
}
