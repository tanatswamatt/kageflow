import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-xl font-semibold">That record isn&apos;t here</h1>
      <p className="text-ink-soft">It may have been deleted, or it belongs to another company.</p>
      <Link href="/dashboard" className="mt-2 text-shadow-700 hover:underline">Go to the dashboard</Link>
    </main>
  );
}
