"use client";

import { useRef } from "react";

export function CompanySwitcher({
  companies,
  activeId,
  action,
}: {
  companies: { id: string; name: string }[];
  activeId: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const form = useRef<HTMLFormElement>(null);
  if (companies.length < 2) {
    return <div className="truncate px-3 text-[15px] font-semibold text-white">{companies[0]?.name}</div>;
  }
  return (
    <form ref={form} action={action}>
      <label className="sr-only" htmlFor="company-switch">Company</label>
      <select
        id="company-switch"
        name="company_id"
        defaultValue={activeId}
        onChange={() => form.current?.requestSubmit()}
        className="w-full rounded-[var(--radius-control)] border border-shadow-700 bg-shadow-800 px-2.5 py-1.5 text-[14px] font-semibold text-white focus:outline-none"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </form>
  );
}
