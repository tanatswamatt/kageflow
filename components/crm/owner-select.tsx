import { Field, Select } from "@/components/ui";
import type { MemberWithProfile } from "@/lib/members";

export function OwnerSelect({ members, value, labelText = "Owner" }: { members: MemberWithProfile[]; value?: string | null; labelText?: string }) {
  return (
    <Field label={labelText}>
      <Select name="owner_id" defaultValue={value ?? ""}>
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>{m.name}</option>
        ))}
      </Select>
    </Field>
  );
}
