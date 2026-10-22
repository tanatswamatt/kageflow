"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { browserClient } from "@/lib/supabase/browser";

async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read photo"))), "image/jpeg", 0.82));
}

export function PhotoUploader({ companyId, unitId, register }: { companyId: string; unitId: string; register: (unitId: string, photos: { url: string; path: string }[]) => Promise<{ error?: string }> }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const supabase = browserClient();
    const done: { url: string; path: string }[] = [];
    const list = [...files].slice(0, 30);
    for (const [i, f] of list.entries()) {
      setBusy(`Uploading ${i + 1} of ${list.length}…`);
      try {
        const blob = await shrink(f);
        const path = `${companyId}/${unitId}/${crypto.randomUUID()}.jpg`;
        const { error: e } = await supabase.storage.from("vehicle-photos").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
        if (e) throw e;
        done.push({ url: supabase.storage.from("vehicle-photos").getPublicUrl(path).data.publicUrl, path });
      } catch (e) {
        setError(`${f.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      }
    }
    if (done.length) {
      setBusy("Saving…");
      const r = await register(unitId, done);
      if (r.error) setError(r.error);
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      <button type="button" disabled={!!busy} onClick={() => input.current?.click()} className={buttonClass("secondary", "sm")}>
        {busy ?? "Add photos"}
      </button>
      <p className="text-xs text-ink-faint">On a phone you can take photos or pick them from your gallery. They are resized before upload.</p>
      {error && <p className="text-[13px] text-ember-700">{error}</p>}
    </div>
  );
}
