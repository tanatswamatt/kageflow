import { logActivity } from "@/app/(app)/crm/actions";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { label } from "@/lib/format";
import { ACTIVITY_TYPES } from "@/lib/types";

type Refs = { account_id?: string | null; contact_id?: string | null; lead_id?: string | null; deal_id?: string | null };

export function LogActivity({ refs, back }: { refs: Refs; back: string }) {
  return (
    <form action={logActivity} className="grid gap-3 border-b border-line p-5 sm:grid-cols-[140px_1fr]">
      <input type="hidden" name="back" value={back} />
      {Object.entries(refs).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <Field label="Type">
        <Select name="type" defaultValue="call">
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>{label(t)}</option>
          ))}
        </Select>
      </Field>
      <Field label="Subject">
        <Input name="subject" required placeholder="Called about the Hilux quote" />
      </Field>
      <Field label="Details" className="sm:col-span-2">
        <Textarea name="body" rows={2} />
      </Field>
      <Field label="Due" hint="Tasks only. Leave blank to log as done.">
        <Input name="due_at" type="datetime-local" />
      </Field>
      <div className="flex items-end justify-end">
        <SubmitButton size="sm">Log activity</SubmitButton>
      </div>
    </form>
  );
}
