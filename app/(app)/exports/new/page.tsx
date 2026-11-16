import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Empty, Field, Input, Notice, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { getMembers } from "@/lib/members";
import { date, today } from "@/lib/format";
import { INCOTERMS } from "@/lib/exports";
import { createExportCase } from "../actions";

export const metadata: Metadata = { title: "New export case" };

type Unit = { id: string; make: string | null; model: string | null; variant: string | null; year: number | null; serial_no: string };
type Line = { unit_id: string | null; description: string; inventory_units: Unit | null };
type Order = {
  id: string;
  number: string | null;
  status: string;
  account_id: string;
  issue_date: string;
  currency: string;
  total: number;
  crm_accounts: { name: string } | null;
  sales_doc_lines: Line[] | null;
};

function defaultProofDue(departure: string): string {
  const d = new Date(`${departure}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

export default async function NewExportCasePage({ searchParams }: { searchParams: Promise<{ order?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("exports.write")) {
    return (
      <>
        <PageHeader title="New export case" back={{ href: "/exports", label: "Export cases" }} />
        <Panel><p className="text-ink-soft">Your role can view export cases but not open one. Ask an owner, admin, accountant or sales colleague.</p></Panel>
      </>
    );
  }

  const [{ data: orderData }, { data: activeData }, { data: ruleset }, members] = await Promise.all([
    ctx.supabase
      .from("sales_docs")
      .select("id, number, status, account_id, issue_date, currency, total, crm_accounts(name), sales_doc_lines(unit_id, description, inventory_units(id, make, model, variant, year, serial_no))")
      .eq("company_id", ctx.companyId)
      .eq("doc_type", "order")
      .in("status", ["open", "fulfilled"])
      .order("issue_date", { ascending: false })
      .limit(200),
    ctx.supabase.from("export_cases").select("unit_id").eq("company_id", ctx.companyId).neq("status", "cancelled"),
    ctx.supabase
      .from("export_rulesets")
      .select("id, version, origin_country, destination_country, effective_from, source_title")
      .eq("company_id", ctx.companyId)
      .eq("status", "published")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getMembers(),
  ]);

  const taken = new Set(((activeData ?? []) as { unit_id: string }[]).map((r) => r.unit_id));
  const orders = (orderData ?? []) as unknown as Order[];
  const options: { value: string; label: string; orderId: string }[] = [];
  for (const order of orders) {
    for (const line of order.sales_doc_lines ?? []) {
      const unit = line.inventory_units;
      if (!line.unit_id || !unit || taken.has(line.unit_id)) continue;
      const vehicle = [unit.year, unit.make, unit.model, unit.variant].filter(Boolean).join(" ") || line.description;
      options.push({
        value: `${order.id}|${unit.id}`,
        orderId: order.id,
        label: `${order.number ?? "Order (draft)"} — ${order.crm_accounts?.name ?? "Buyer"} — ${vehicle} — ${unit.serial_no}`,
      });
    }
  }

  const preselectedOrder = sp.order && options.some((o) => o.orderId === sp.order) ? sp.order : null;
  const preselectedUnits = options.filter((o) => o.orderId === preselectedOrder);
  const defaultValue = preselectedUnits.length === 1 ? preselectedUnits[0]!.value : undefined;
  const departure = today();
  const due = defaultProofDue(departure);

  return (
    <>
      <PageHeader
        title="New export case"
        description="Choose a confirmed sale and the vehicle on it. The buyer, car and sale stay in their existing Kageflow records; this case only adds the export details, checklist and evidence."
        back={{ href: "/exports", label: "Export cases" }}
      />
      <Notice params={sp} />

      {!ruleset ? (
        <Panel><Empty title="No published export checklist">
          An owner or admin must publish a corridor checklist before cases can be opened. The database seeds one for the home corridor; check that the latest migration has run.
        </Empty></Panel>
      ) : options.length === 0 ? (
        <Panel><Empty title="No confirmed order is ready for export">
          Confirm a <Link href="/sales/orders" className="text-shadow-700 hover:underline">sales order</Link> that has a vehicle on it, and make sure that vehicle does not already have an open export case.
        </Empty></Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Panel title="Case details">
            <form action={createExportCase} className="flex flex-col gap-5">
              <Field label="Sale and vehicle" hint="Only confirmed orders and vehicles without an open export case are listed.">
                <Select name="sale" required defaultValue={defaultValue}>
                  <option value="">Choose a sale and vehicle</option>
                  {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Route" hint="For example Beitbridge road corridor">
                  <Input name="route" defaultValue="Beitbridge road corridor" required />
                </Field>
                <Field label="Incoterm">
                  <Select name="incoterm" defaultValue="DAP">
                    {INCOTERMS.map((i) => <option key={i} value={i}>{i}</option>)}
                  </Select>
                </Field>
              </div>

              <Field label="Named place (Incoterm)" hint="Optional: the place named after the Incoterm, for example Beitbridge border post.">
                <Input name="incoterm_place" placeholder="Beitbridge border post" />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Planned departure">
                  <Input name="planned_departure" type="date" defaultValue={departure} required />
                </Field>
                <Field label="Planned arrival">
                  <Input name="planned_arrival" type="date" required />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Proof-of-export due date" hint="The date the accepted proof of export must be on file.">
                  <Input name="proof_of_export_due_date" type="date" defaultValue={due} required />
                </Field>
                <Field label="Proof-of-export owner">
                  <Select name="proof_of_export_owner" defaultValue={ctx.user.id} required>
                    {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
                  </Select>
                </Field>
              </div>

              <Field label="Case owner" hint="The person who owns the next step when a check fails.">
                <Select name="owner_id" defaultValue={ctx.user.id}>
                  {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
                </Select>
              </Field>

              <Field label="Extra destination requirements" hint="Anything specific to this buyer or shipment that is not already in the corridor checklist.">
                <Textarea name="destination_requirements" rows={3} placeholder="For example: buyer's clearing agent requires a certified copy of the export permit." />
              </Field>

              <Field label="Internal notes">
                <Textarea name="notes" rows={2} />
              </Field>

              <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
                <p className="text-[13px] text-ink-faint">Creating the case runs the checklist once so you see the blockers immediately.</p>
                <SubmitButton pendingText="Creating and checking…">Create case</SubmitButton>
              </div>
            </form>
          </Panel>

          <div className="flex flex-col gap-6">
            <Panel title="This corridor">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-faint">Route</dt><dd>{ruleset.origin_country} → {ruleset.destination_country}</dd>
                <dt className="text-ink-faint">Checklist</dt><dd>Version {ruleset.version}</dd>
                <dt className="text-ink-faint">Effective</dt><dd>{date(ruleset.effective_from)}</dd>
                <dt className="text-ink-faint">Source</dt><dd className="break-words">{ruleset.source_title}</dd>
              </dl>
              <p className="mt-4 text-[13px] text-ink-soft">The checklist is a control, not legal advice. A compliance owner should review the source and publish a new version when the rules change.</p>
            </Panel>
            <Panel title="What happens next">
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] text-ink-soft">
                <li>The case opens as a draft and the six deterministic checks run.</li>
                <li>Attach the required documents and have a reviewer accept them.</li>
                <li>Fix blocked items and run the checklist again.</li>
                <li>When every blocking check passes, an owner or admin approves.</li>
                <li>A separate release action records who released the vehicle and how.</li>
              </ol>
            </Panel>
            <ButtonLink href="/exports" tone="quiet">Cancel</ButtonLink>
          </div>
        </div>
      )}
    </>
  );
}
