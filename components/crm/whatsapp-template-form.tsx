"use client";

import { useMemo, useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export type TemplateOption = { id: string; name: string; language: string; body: string; params: string[] };

/** Pick an approved template, fill its values, see the message before it goes */
export function WhatsAppTemplateForm({ templates, leadId, back, suggestions, action }: {
  templates: TemplateOption[];
  leadId: string;
  back: string;
  suggestions: string[];
  action: (fd: FormData) => Promise<void>;
}) {
  const [id, setId] = useState(templates[0]?.id ?? "");
  const t = templates.find((x) => x.id === id);
  const [values, setValues] = useState<Record<string, string>>({});
  const val = (i: number) => values[`${id}:${i}`] ?? suggestions[i] ?? "";
  const preview = useMemo(() => {
    if (!t) return "";
    return t.params.reduce((s, p, i) => s.replace(new RegExp(`\\{\\{\\s*${p}\\s*\\}\\}`, "g"), val(i) || `[${p}]`), t.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, values, id]);

  if (templates.length === 0) return null;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="back" value={back} />
      <Field label="Template">
        <Select name="template_id" value={id} onChange={(e) => setId(e.target.value)}>
          {templates.map((x) => <option key={x.id} value={x.id}>{x.name.replace(/_/g, " ")} ({x.language})</option>)}
        </Select>
      </Field>
      {t?.params.map((p, i) => (
        <Field key={`${id}:${i}`} label={/^\d+$/.test(p) ? `Value ${p}` : p.replace(/_/g, " ")}>
          <Input name={`v_${i}`} required value={val(i)} onChange={(e) => setValues((v) => ({ ...v, [`${id}:${i}`]: e.target.value }))} />
        </Field>
      ))}
      {t && <div className="whitespace-pre-line rounded-[var(--radius-control)] bg-jade-50 px-3 py-2 text-sm">{preview}</div>}
      <div><SubmitButton size="sm" tone="secondary" pendingText="Sending…">Send template</SubmitButton></div>
    </form>
  );
}
