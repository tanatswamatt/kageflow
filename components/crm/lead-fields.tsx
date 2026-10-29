import { Field, Input, Select, Textarea } from "@/components/ui";
import { ConsentFields } from "./consent-fields";
import { OwnerSelect } from "./owner-select";
import { label } from "@/lib/format";
import { LEAD_SOURCES, SOURCE_LABEL, type Lead } from "@/lib/types";
import type { MemberWithProfile } from "@/lib/members";

export function LeadFields({ lead, members, defaultOwner, currency, law }: { lead?: Lead; members: MemberWithProfile[]; defaultOwner?: string; currency: string; law?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="First name"><Input name="first_name" defaultValue={lead?.first_name ?? ""} autoComplete="off" /></Field>
      <Field label="Last name"><Input name="last_name" defaultValue={lead?.last_name ?? ""} autoComplete="off" /></Field>
      <Field label="Company" className="sm:col-span-2"><Input name="company_name" defaultValue={lead?.company_name ?? ""} /></Field>
      <Field label="Email"><Input name="email" type="email" defaultValue={lead?.email ?? ""} /></Field>
      <Field label="Phone or WhatsApp"><Input name="phone" type="tel" defaultValue={lead?.phone ?? ""} /></Field>
      <Field label="Source">
        <Select name="source" defaultValue={lead?.source ?? "manual"}>
          {LEAD_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
        </Select>
      </Field>
      <Field label="Source detail" hint="Campaign, referrer or page"><Input name="source_detail" defaultValue={lead?.source_detail ?? ""} /></Field>
      <Field label="Interested in" className="sm:col-span-2"><Input name="interest" defaultValue={lead?.interest ?? ""} placeholder="2021 Toyota Hilux 2.8 GD-6, export to Kenya" /></Field>
      <Field label={`Estimated value (${lead?.currency ?? currency})`}>
        <Input name="estimated_value" inputMode="decimal" defaultValue={lead?.estimated_value ?? ""} />
      </Field>
      <OwnerSelect members={members} value={lead ? lead.owner_id : defaultOwner} />
      <ConsentFields basis={lead?.consent_basis} source={lead?.consent_source} law={law} />
      <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={lead?.notes ?? ""} /></Field>
    </div>
  );
}
