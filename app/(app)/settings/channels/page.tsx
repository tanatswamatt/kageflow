import type { Metadata } from "next";
import { headers } from "next/headers";
import { Badge, Field, Input, Notice, PageHeader, Panel, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { CopyField } from "@/components/copy-field";
import { getContext } from "@/lib/context";
import { dateTime } from "@/lib/format";
import type { LeadChannel, ListingFeed } from "@/lib/types";
import { addFeed, addLeadChannel, removeFeed, removeLeadChannel, saveWhatsApp, toggleFeed, toggleLeadChannel } from "./actions";

export const metadata: Metadata = { title: "Listings and leads" };

const CHANNEL_LABEL: Record<string, string> = { autotrader: "AutoTrader", cars_co_za: "Cars.co.za", facebook: "Facebook", website: "Website", other: "Other" };

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("company.manage")) return <Panel><p className="text-ink-soft">Only owners and admins can manage listings and lead channels.</p></Panel>;
  const [{ data: feedData }, { data: chData }, { count: published }] = await Promise.all([
    ctx.supabase.from("listing_feeds").select("*").eq("company_id", ctx.companyId).order("created_at"),
    ctx.supabase.from("lead_channels").select("*").eq("company_id", ctx.companyId).order("created_at"),
    ctx.supabase.from("inventory_units").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("is_published", true),
  ]);
  const feeds = (feedData ?? []) as ListingFeed[];
  const channels = (chData ?? []) as LeadChannel[];
  const email = channels.filter((c) => c.kind === "email");
  const whatsapp = channels.filter((c) => c.kind === "whatsapp");
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get("origin") ?? "https://app.kageflow.co.za";

  return (
    <>
      <PageHeader title="Listings and leads" description="Send your stock to the portals and your website, and bring every enquiry back in as a lead tied to the car." />
      <Notice params={sp} />
      <div className="flex flex-col gap-6">
        <Panel title="Stock feeds">
          <p className="mb-4 text-ink-soft">
            Each feed is a private link that always shows your advertised vehicles: {published ?? 0} right now. Tick &ldquo;Publish&rdquo; on a vehicle&apos;s Advert panel to add it.
            Sold vehicles drop off by themselves. Costs and customer details are never included.
          </p>
          {feeds.length > 0 && (
            <ul className="-mx-5 mb-5 divide-y divide-line border-y border-line">
              {feeds.map((f) => {
                const url = `${origin}/api/feed/${f.token}`;
                return (
                  <li key={f.id} className="flex flex-col gap-2 px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{f.name} <Badge tone="shadow">{CHANNEL_LABEL[f.channel] ?? f.channel}</Badge></div>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={f.is_active ? "jade" : "neutral"}>{f.is_active ? "On" : "Paused"}</Badge>
                        <form action={toggleFeed}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="active" value={String(!f.is_active)} /><SubmitButton size="sm" tone="quiet" pendingText="…">{f.is_active ? "Pause" : "Switch on"}</SubmitButton></form>
                        <form action={removeFeed}><input type="hidden" name="id" value={f.id} /><SubmitButton size="sm" tone="quiet" confirm="Remove this feed? Anything reading it stops getting your stock." pendingText="…">Remove</SubmitButton></form>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div><div className="mb-1 text-xs text-ink-faint">JSON (websites, developers)</div><CopyField value={url} /></div>
                      <div><div className="mb-1 text-xs text-ink-faint">XML (portals)</div><CopyField value={`${url}?format=xml`} /></div>
                      <div><div className="mb-1 text-xs text-ink-faint">CSV (spreadsheet or bulk upload)</div><CopyField value={`${url}?format=csv`} /></div>
                    </div>
                    <div className="text-xs text-ink-faint">{f.include_reserved ? "Includes reserved vehicles, marked reserved" : "Available vehicles only"} · {f.last_fetched_at ? `Last read ${dateTime(f.last_fetched_at)}, ${f.fetch_count} times in total` : "Not read yet"}</div>
                  </li>
                );
              })}
            </ul>
          )}
          <form action={addFeed} className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
            <Field label="For"><Select name="channel" defaultValue="autotrader">{Object.entries(CHANNEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" name="include_reserved" defaultChecked className="size-4 accent-jade-700" /> Include reserved vehicles</label>
            <SubmitButton size="sm">Create feed</SubmitButton>
          </form>
          <div className="mt-5 rounded-[var(--radius-control)] bg-paper p-4 text-sm text-ink-soft">
            <p className="font-medium text-ink">Getting AutoTrader and Cars.co.za to read it</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Create a feed for each portal above.</li>
              <li>Email your account manager at the portal: &ldquo;Please pull our stock from this feed&rdquo;, with the XML link.</li>
              <li>If they need their own format or only accept approved providers, forward their reply to Pretan and we&apos;ll connect it.</li>
              <li>Until then, the CSV link opens in Excel for their bulk upload.</li>
            </ol>
          </div>
        </Panel>

        <Panel title="Leads from AutoTrader, Cars.co.za and email">
          <p className="mb-4 text-ink-soft">Portal enquiries arrive by email. Forward them to a Kageflow lead address and each one becomes a lead, matched to the car by its stock number or VIN, without duplicating people who already enquired.</p>
          {email.map((c) => {
            const url = `${origin}/api/inbound/email/${c.token}`;
            return (
              <div key={c.id} className="mb-4 flex flex-col gap-2 rounded-[var(--radius-control)] border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{c.name}</div>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={c.is_active ? "jade" : "neutral"}>{c.received_count} received</Badge>
                    <form action={toggleLeadChannel}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={String(!c.is_active)} /><SubmitButton size="sm" tone="quiet" pendingText="…">{c.is_active ? "Pause" : "Switch on"}</SubmitButton></form>
                    <form action={removeLeadChannel}><input type="hidden" name="id" value={c.id} /><SubmitButton size="sm" tone="quiet" confirm="Remove this lead address?" pendingText="…">Remove</SubmitButton></form>
                  </div>
                </div>
                <div><div className="mb-1 text-xs text-ink-faint">Inbound webhook address</div><CopyField value={url} secret /></div>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
                  <li>Create a free inbound email address at CloudMailin or Postmark, and set its webhook (JSON) to the address above.</li>
                  <li>In Gmail or Outlook, add a rule: emails from autotrader.co.za, cars.co.za and your website form are forwarded to that inbound email address.</li>
                  <li>Send yourself a test enquiry. It shows under CRM, Leads within a minute.</li>
                </ol>
                {c.last_received_at && <div className="text-xs text-ink-faint">Last lead {dateTime(c.last_received_at)}</div>}
              </div>
            );
          })}
          {email.length === 0 && <form action={addLeadChannel}><input type="hidden" name="kind" value="email" /><SubmitButton size="sm">Create a lead address</SubmitButton></form>}
        </Panel>

        <Panel title="WhatsApp">
          <p className="mb-4 text-ink-soft">Connect your WhatsApp Business number. Every message becomes a lead or joins the person&apos;s existing lead, and your team replies from the lead page.</p>
          {whatsapp.map((c) => {
            const url = `${origin}/api/whatsapp/${c.token}`;
            const digits = (c.display_phone ?? "").replace(/\D/g, "");
            return (
              <div key={c.id} className="mb-4 flex flex-col gap-3 rounded-[var(--radius-control)] border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{c.display_phone || c.name}</div>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={c.access_token && c.phone_number_id ? "jade" : "amber"}>{c.access_token && c.phone_number_id ? `${c.received_count} messages` : "Setup not finished"}</Badge>
                    <form action={toggleLeadChannel}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={String(!c.is_active)} /><SubmitButton size="sm" tone="quiet" pendingText="…">{c.is_active ? "Pause" : "Switch on"}</SubmitButton></form>
                    <form action={removeLeadChannel}><input type="hidden" name="id" value={c.id} /><SubmitButton size="sm" tone="quiet" confirm="Disconnect WhatsApp?" pendingText="…">Remove</SubmitButton></form>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div><div className="mb-1 text-xs text-ink-faint">Callback URL (Meta webhook)</div><CopyField value={url} secret /></div>
                  <div><div className="mb-1 text-xs text-ink-faint">Verify token</div><CopyField value={c.verify_token ?? ""} /></div>
                </div>
                <form action={saveWhatsApp} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="id" value={c.id} />
                  <Field label="Business WhatsApp number"><Input name="display_phone" defaultValue={c.display_phone ?? ""} placeholder="+27 82 000 0000" /></Field>
                  <Field label="Phone number ID"><Input name="phone_number_id" defaultValue={c.phone_number_id ?? ""} inputMode="numeric" /></Field>
                  <Field label="Permanent access token" hint={c.access_token ? "Saved. Leave blank to keep it." : "From a Meta system user"}><Input name="access_token" type="password" autoComplete="off" /></Field>
                  <Field label="App secret" hint={c.app_secret ? "Saved. Leave blank to keep it." : "Meta app, Settings, Basic"}><Input name="app_secret" type="password" autoComplete="off" /></Field>
                  <div><SubmitButton size="sm">Save WhatsApp details</SubmitButton></div>
                </form>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
                  <li>In Meta for Developers, open your app&apos;s WhatsApp, API setup. Copy the phone number ID into the box above.</li>
                  <li>Create a permanent token (Business settings, System users, generate token with whatsapp_business_messaging) and paste it.</li>
                  <li>Paste the app secret from App settings, Basic. Kageflow uses it to reject fake messages.</li>
                  <li>Under WhatsApp, Configuration, set the callback URL and verify token above, then subscribe to <span className="font-mono">messages</span>.</li>
                </ol>
                {digits && (
                  <div className="text-sm">
                    <div className="mb-1 text-xs text-ink-faint">Link for your adverts (change the stock number per car)</div>
                    <CopyField value={`https://wa.me/${digits}?text=${encodeURIComponent("Hi, I'm interested in STK-000001")}`} />
                  </div>
                )}
              </div>
            );
          })}
          {whatsapp.length === 0 && <form action={addLeadChannel}><input type="hidden" name="kind" value="whatsapp" /><SubmitButton size="sm">Connect WhatsApp</SubmitButton></form>}
        </Panel>
      </div>
    </>
  );
}
