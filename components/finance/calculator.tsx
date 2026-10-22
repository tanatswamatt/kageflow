"use client";

import { useState } from "react";
import { instalment } from "@/lib/finance";

const fmt = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const n = (v: string) => {
  const x = Number(v.replace(/[\s,]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const box = "h-9 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-right text-sm tabular-nums";

export function FinanceCalculator({ amount, rate = 12.75, term = 72, balloonPct = 0 }: { amount: number; rate?: number; term?: number; balloonPct?: number }) {
  const [a, setA] = useState(String(amount || ""));
  const [r, setR] = useState(String(rate));
  const [t, setT] = useState(String(term));
  const [b, setB] = useState(String(balloonPct));
  const [fee, setFee] = useState("");
  const principal = n(a);
  const balloon = (principal * n(b)) / 100;
  const pmt = instalment(principal, n(r), Math.round(n(t)), balloon, n(fee));
  const total = pmt * Math.round(n(t)) + balloon;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 text-xs text-ink-soft">
        <label className="flex flex-col gap-1">Amount to finance (R)<input className={box} inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} /></label>
        <label className="flex flex-col gap-1">Interest rate (% a year)<input className={box} inputMode="decimal" value={r} onChange={(e) => setR(e.target.value)} /></label>
        <label className="flex flex-col gap-1">Term (months)<input className={box} inputMode="numeric" value={t} onChange={(e) => setT(e.target.value)} /></label>
        <label className="flex flex-col gap-1">Balloon (%)<input className={box} inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} /></label>
        <label className="col-span-2 flex flex-col gap-1">Bank's monthly service fee (R, optional)<input className={box} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" /></label>
      </div>
      <div className="rounded-[var(--radius-control)] bg-paper px-3 py-2.5">
        <div className="flex items-baseline justify-between"><span className="text-sm text-ink-soft">Monthly instalment</span><span className="text-[20px] font-semibold tabular-nums">R {fmt(pmt)}</span></div>
        <div className="mt-1 flex justify-between text-xs text-ink-faint"><span>Balloon at the end R {fmt(balloon)}</span><span>Total repaid R {fmt(total)}</span></div>
      </div>
      <p className="text-xs text-ink-faint">An estimate. The bank&apos;s offer sets the real rate and fees.</p>
    </div>
  );
}
