import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { anonClient } from "@/lib/supabase/anon";
import { DocumentView, type DocumentData } from "@/components/sales/document-view";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "Document", robots: { index: false, follow: false } };

export default async function SharedDocPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32,64}$/.test(token)) notFound();
  const { data } = await anonClient().rpc("shared_sales_doc", { p_token: token });
  if (!data) notFound();
  return (
    <main className="min-h-dvh bg-paper py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden"><PrintButton /></div>
      <div className="shadow-sm print:shadow-none"><DocumentView data={data as DocumentData} /></div>
      <p className="mt-6 text-center text-[12px] text-ink-faint print:hidden">Sent with Kageflow</p>
    </main>
  );
}
