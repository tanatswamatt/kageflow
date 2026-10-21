import { Field, Input, Select, Textarea } from "@/components/ui";
import { OwnerSelect } from "./owner-select";
import { label } from "@/lib/format";
import { ACCOUNT_KINDS, type CrmAccount } from "@/lib/types";
import type { MemberWithProfile } from "@/lib/members";

export function AccountFields({ account, members, defaultOwner }: { account?: CrmAccount; members: MemberWithProfile[]; defaultOwner?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" className="sm:col-span-2"><Input name="name" required defaultValue={account?.name ?? ""} /></Field>
      <Field label="Type">
        <Select name="kind" defaultValue={account?.kind ?? "prospect"}>
          {ACCOUNT_KINDS.map((k) => <option key={k} value={k}>{label(k)}</option>)}
        </Select>
      </Field>
      <Field label="Industry"><Input name="industry" defaultValue={account?.industry ?? ""} /></Field>
      <Field label="Email"><Input name="email" type="email" defaultValue={account?.email ?? ""} /></Field>
      <Field label="Phone"><Input name="phone" type="tel" defaultValue={account?.phone ?? ""} /></Field>
      <Field label="City"><Input name="city" defaultValue={account?.city ?? ""} /></Field>
      <Field label="Country code" hint="Two letters, e.g. ZA, KE"><Input name="country" maxLength={2} defaultValue={account?.country ?? "ZA"} /></Field>
      <Field label="Website"><Input name="website" defaultValue={account?.website ?? ""} /></Field>
      <Field label="VAT number"><Input name="vat_no" defaultValue={account?.vat_no ?? ""} /></Field>
      <Field label="Billing address" hint="Required on tax invoices over R5,000" className="sm:col-span-2"><Textarea name="billing_address" rows={2} defaultValue={account?.billing_address ?? ""} /></Field>
      <Field label="Payment terms (days)" hint="Blank uses the company default"><Input name="payment_days" inputMode="numeric" defaultValue={account?.payment_days ?? ""} /></Field>
      <OwnerSelect members={members} value={account ? account.owner_id : defaultOwner} />
      <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={account?.notes ?? ""} /></Field>
    </div>
  );
}
