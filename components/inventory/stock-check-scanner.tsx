"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { VinScanner } from "@/components/inventory/vin-scanner";
import type { ScanResult } from "@/app/(app)/inventory/stock-check/actions";

export function StockCheckScanner({ checkId, add }: { checkId: string; add: (checkId: string, vin: string) => Promise<ScanResult> }) {
  const [recent, setRecent] = useState<ScanResult[]>([]);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const scan = (vin: string) =>
    start(async () => {
      const r = await add(checkId, vin);
      setRecent((x) => [r, ...x].slice(0, 8));
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-3">
      <VinScanner continuous onVin={scan} />
      <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { scan(typed); setTyped(""); } }} className="flex gap-2">
        <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} placeholder="Or type a VIN" autoCapitalize="characters" autoComplete="off" spellCheck={false}
          className="h-11 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 font-mono text-[15px] uppercase" />
        <button type="submit" disabled={pending} className={buttonClass("secondary")}>Add</button>
      </form>
      <ul className="flex flex-col gap-1.5">
        {recent.map((r, i) => (
          <li key={`${r.vin}-${i}`} className={`rounded-[var(--radius-control)] px-3 py-2 text-[14px] ${r.error ? "bg-ember-50 text-ember-700" : r.unitId ? "bg-jade-50 text-jade-700" : "bg-amber-50 text-amber-700"}`}>
            <span className="font-mono">{r.vin}</span> · {r.error ?? (r.unitId ? `${r.label}${r.duplicate ? " (already scanned)" : ""}` : "Not in Kageflow")}
          </li>
        ))}
      </ul>
    </div>
  );
}
