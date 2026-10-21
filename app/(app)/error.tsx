"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-ember-700/25 bg-ember-50 p-6">
      <h1 className="font-semibold text-ember-700">This page couldn&apos;t load</h1>
      <p className="mt-1 text-ink-soft">{error.message || "An unexpected error occurred."}</p>
      <button onClick={reset} className="mt-3 text-sm font-medium text-shadow-700 hover:underline">Try again</button>
    </div>
  );
}
