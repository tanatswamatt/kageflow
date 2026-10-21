"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-[6px] bg-[#0b6b5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f7f71]">
      Print or save as PDF
    </button>
  );
}
