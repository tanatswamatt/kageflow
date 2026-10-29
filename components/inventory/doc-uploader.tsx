"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { browserClient } from "@/lib/supabase/browser";

/** Uploads the registration document to the private documents bucket (never public: it carries the owner's details) */
export function DocUploader({ companyId, unitId, hasDoc, save }: {
  companyId: string; unitId: string; hasDoc: boolean;
  save: (unitId: string, path: string) => Promise<{ error?: string }>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 10 * 1024 * 1024) return setError("That file is over 10 MB. Take a smaller photo or scan.");
    const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
    if (!/^(image\/|application\/pdf)/.test(file.type)) return setError("Upload a photo or a PDF of the document.");
    setBusy(true);
    try {
      const path = `${companyId}/${unitId}/registration-${crypto.randomUUID()}.${ext}`;
      const { error: e } = await browserClient().storage.from("vehicle-documents").upload(path, file, { contentType: file.type });
      if (e) throw e;
      const r = await save(unitId, path);
      if (r.error) throw new Error(r.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={buttonClass("secondary", "sm")}>
        {busy ? "Uploading…" : hasDoc ? "Replace the document" : "Add the registration document"}
      </button>
      {error && <p className="text-[13px] text-ember-700">{error}</p>}
    </div>
  );
}
