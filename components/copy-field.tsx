"use client";

import { useState } from "react";

export function CopyField({ value, secret = false }: { value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!secret);
  return (
    <div className="flex gap-1.5">
      <input
        readOnly
        value={shown ? value : "•".repeat(Math.min(value.length, 32))}
        onFocus={(e) => e.currentTarget.select()}
        className="h-9 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line-strong bg-paper px-2.5 font-mono text-[12px] text-ink"
        aria-label="Value to copy"
      />
      {secret && (
        <button type="button" onClick={() => setShown((s) => !s)} className="rounded-[var(--radius-control)] border border-line-strong px-2.5 text-[13px] hover:bg-paper">
          {shown ? "Hide" : "Show"}
        </button>
      )}
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            setShown(true);
          }
        }}
        className="rounded-[var(--radius-control)] border border-line-strong px-2.5 text-[13px] hover:bg-paper"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
