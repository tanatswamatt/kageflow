"use client";

import { useMemo, useState } from "react";
import { buttonClass } from "@/components/ui";

export type PickerAccount = { id: string; name: string; email?: string | null; phone?: string | null };

const field = "h-10 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm focus:border-shadow-700 focus:outline-none focus:ring-2 focus:ring-shadow-100";

/**
 * Search existing customers (or suppliers) by name, email or phone, or add a new one on the spot.
 * Sends account_id, or new_account=1 with new_account_name / _phone / _email. lib/accounts resolveAccount reads both.
 */
export function AccountPicker({ accounts, defaultValue, label = "Customer", noun = "customer", optional = false, onChange }: {
  accounts: PickerAccount[];
  defaultValue?: string | null;
  label?: string;
  noun?: string;
  optional?: boolean;
  onChange?: (id: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(defaultValue && accounts.some((a) => a.id === defaultValue) ? defaultValue : null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", phone: "", email: "" });
  const selected = accounts.find((a) => a.id === value);
  const digits = (s: string) => s.replace(/\D/g, "");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qd = digits(q);
    const list = q
      ? accounts.filter((a) => a.name.toLowerCase().includes(q) || (a.email ?? "").toLowerCase().includes(q) || (qd.length >= 4 && digits(a.phone ?? "").includes(qd)))
      : accounts;
    return list.slice(0, 8);
  }, [accounts, query]);

  const pick = (id: string | null) => { setValue(id); setOpen(false); setCreating(false); onChange?.(id); };
  const startNew = () => {
    const q = query.trim();
    const isPhone = digits(q).length >= 7 && !/[a-z]/i.test(q);
    const isEmail = q.includes("@");
    setDraft({ name: isPhone || isEmail ? "" : q, phone: isPhone ? q : "", email: isEmail ? q : "" });
    setCreating(true); setOpen(false); setValue(null); onChange?.(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      {creating ? (
        <div className="grid gap-2 rounded-[var(--radius-control)] border border-line p-3 sm:grid-cols-2">
          <input type="hidden" name="new_account" value="1" />
          <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-[12px] text-ink-faint">Name or company</span>
            <input name="new_account_name" required autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} /></label>
          <label className="flex flex-col gap-1"><span className="text-[12px] text-ink-faint">Phone</span>
            <input name="new_account_phone" type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={field} /></label>
          <label className="flex flex-col gap-1"><span className="text-[12px] text-ink-faint">Email</span>
            <input name="new_account_email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={field} /></label>
          <div className="flex items-center justify-between gap-2 sm:col-span-2">
            <span className="text-[12px] text-ink-faint">Saved as a new {noun} when you submit. If the phone or email is already on file, that {noun} is used.</span>
            <button type="button" onClick={() => setCreating(false)} className={buttonClass("quiet", "sm")}>Choose existing</button>
          </div>
        </div>
      ) : selected && !open ? (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2">
          <input type="hidden" name="account_id" value={selected.id} />
          <div className="min-w-0">
            <div className="truncate font-medium">{selected.name}</div>
            {(selected.phone || selected.email) && <div className="truncate text-[12px] text-ink-faint">{[selected.phone, selected.email].filter(Boolean).join(" · ")}</div>}
          </div>
          <button type="button" onClick={() => { setOpen(true); setQuery(""); }} className={buttonClass("quiet", "sm")}>Change</button>
        </div>
      ) : (
        <div className="relative">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={`Search ${noun}s by name, phone or email, or type a new one`}
            className={field}
            aria-label={`Search ${noun}s`}
          />
          {open && (
            <ul className="absolute z-20 mt-1 max-h-72 w-full divide-y divide-line overflow-y-auto rounded-[var(--radius-control)] border border-line bg-surface shadow-lg">
              {matches.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => pick(a.id)} className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-paper">
                    <span className="font-medium">{a.name}</span>
                    {(a.phone || a.email) && <span className="text-xs text-ink-faint">{[a.phone, a.email].filter(Boolean).join(" · ")}</span>}
                  </button>
                </li>
              ))}
              {matches.length === 0 && query.trim() && <li className="px-3 py-2 text-[13px] text-ink-faint">No {noun} matches &ldquo;{query.trim()}&rdquo;</li>}
              <li>
                <button type="button" onClick={startNew} className="w-full px-3 py-2 text-left font-medium text-jade-700 hover:bg-paper">
                  + New {noun}{query.trim() ? `: ${query.trim()}` : ""}
                </button>
              </li>
              {optional && value === null && (
                <li><button type="button" onClick={() => setOpen(false)} className="w-full px-3 py-2 text-left text-[13px] text-ink-faint hover:bg-paper">Leave empty</button></li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
