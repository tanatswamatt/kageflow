"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";
import { CopyField } from "@/components/copy-field";

type State = { key?: string; error?: string } | null;

export function CreateKeyForm({ action }: { action: (prev: State, fd: FormData) => Promise<{ key?: string; error?: string }> }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">Key name</span>
          <input name="name" required placeholder="Kalali website" className="h-9 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm focus:border-shadow-700 focus:outline-none focus:ring-2 focus:ring-shadow-100" />
        </label>
        <Create />
      </form>
      {state?.error && <p role="alert" className="text-ember-700">{state.error}</p>}
      {state?.key && (
        <div className="rounded-[var(--radius-control)] border border-jade-700/30 bg-jade-50 p-3">
          <p className="mb-2 text-sm font-medium text-jade-700">Copy this key now. It won&apos;t be shown again.</p>
          <CopyField value={state.key} />
          <p className="mt-2 text-[13px] text-ink-soft">Store it as a server-side secret (e.g. KAGEFLOW_API_KEY). Never put it in browser code.</p>
        </div>
      )}
    </div>
  );
}

function Create() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={buttonClass("primary")}>{pending ? "Creating…" : "Create key"}</button>;
}
