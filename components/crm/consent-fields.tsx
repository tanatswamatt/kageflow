import { Field, Input, Select } from "@/components/ui";
import { label } from "@/lib/format";
import { CONSENT_BASES, type ConsentBasis } from "@/lib/types";

/** POPIA: record why we may hold and use this person's details */
export function ConsentFields({ basis, source }: { basis?: ConsentBasis; source?: string | null }) {
  return (
    <>
      <Field label="POPIA basis" hint="Why you may hold and contact this person">
        <Select name="consent_basis" defaultValue={basis ?? "not_recorded"}>
          {CONSENT_BASES.map((b) => (
            <option key={b} value={b}>{label(b)}</option>
          ))}
        </Select>
      </Field>
      <Field label="Consent source" hint="e.g. website enquiry form, signed quote">
        <Input name="consent_source" defaultValue={source ?? ""} />
      </Field>
    </>
  );
}
