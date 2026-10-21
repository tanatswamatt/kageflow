import { moveDeal } from "@/app/(app)/crm/actions";
import { Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { Stage } from "@/lib/types";

/** Move a deal to another stage. A lost stage asks for a reason. */
export function StageMove({ dealId, stageId, stages, back, compact = false }: { dealId: string; stageId: string; stages: Stage[]; back: string; compact?: boolean }) {
  return (
    <form action={moveDeal} className={compact ? "flex gap-1.5" : "flex flex-col gap-3"}>
      <input type="hidden" name="id" value={dealId} />
      <input type="hidden" name="back" value={back} />
      <Select name="stage_id" defaultValue={stageId} aria-label="Stage" className={compact ? "h-8 text-[13px]" : ""}>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </Select>
      {!compact && <Input name="lost_reason" placeholder="Reason, if moving to a lost stage" aria-label="Lost reason" />}
      <SubmitButton size="sm" tone={compact ? "secondary" : "primary"} pendingText="…">Move</SubmitButton>
    </form>
  );
}
