/** Kageflow mark: a leaf-shaped "shadow" over a ledger line */
export function Logo({ className = "", inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 18C4 9 10 4 20 4c0 10-5 16-14 16H4z" fill={inverted ? "#e8e9f7" : "#1e2346"} />
        <path d="M4 20L15 9" stroke={inverted ? "#0f7f71" : "#0b6b5f"} strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">kageflow</span>
    </span>
  );
}
