"use client";

import { useEffect, useRef, useState } from "react";
import { cleanVin } from "@/lib/vin";

type Detector = { detect: (src: CanvasImageSource | ImageBitmap) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;
const FORMATS = ["code_39", "code_128", "data_matrix", "qr_code", "pdf417"];

function getDetector(): Detector | null {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: FORMATS });
  } catch {
    return null;
  }
}

/** Finds a 17-character VIN in whatever the barcode holds */
function vinFrom(raw: string): string | null {
  const v = cleanVin(raw);
  if (v.length === 17 && !/[IOQ]/.test(v)) return v;
  const m = raw.toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/);
  return m ? m[0] : null;
}

/**
 * Camera VIN scanner. Uses the browser's barcode reader (Chrome and Edge on Android, Chrome on desktop).
 * Where that isn't available (iPhone Safari), it says so and the typed VIN box is used instead.
 */
export function VinScanner({ onVin, continuous = false }: { onVin: (vin: string) => void; continuous?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const last = useRef<{ vin: string; at: number } | null>(null);
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(!!getDetector() && !!navigator.mediaDevices?.getUserMedia);
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stop() {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setOn(false);
  }

  async function start() {
    const detector = getDetector();
    if (!detector) return;
    setMsg(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false });
    } catch {
      setMsg("Camera blocked. Allow camera access for this site, or type the VIN.");
      return;
    }
    if (!video.current) return;
    video.current.srcObject = stream.current;
    await video.current.play().catch(() => undefined);
    setOn(true);
    timer.current = window.setInterval(async () => {
      if (!video.current || video.current.readyState < 2) return;
      try {
        const codes = await detector.detect(video.current);
        for (const c of codes) {
          const vin = vinFrom(c.rawValue);
          if (!vin) continue;
          const now = Date.now();
          if (last.current && last.current.vin === vin && now - last.current.at < 4000) continue;
          last.current = { vin, at: now };
          navigator.vibrate?.(80);
          onVin(vin);
          if (!continuous) stop();
          return;
        }
      } catch {
        /* keep scanning */
      }
    }, 350);
  }

  if (supported === false) {
    return <p className="rounded-[var(--radius-control)] bg-paper px-3 py-2 text-[13px] text-ink-soft">This browser can&apos;t read barcodes (iPhones can&apos;t yet). Type the VIN below, or use Chrome on an Android phone to scan.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className={`relative overflow-hidden rounded-[var(--radius-control)] bg-shadow-900 ${on ? "" : "hidden"}`}>
        <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
        <div className="pointer-events-none absolute inset-x-6 top-1/2 h-16 -translate-y-1/2 rounded border-2 border-jade-600/80" aria-hidden="true" />
        <p className="absolute inset-x-0 bottom-2 text-center text-xs text-white/90">Point at the VIN barcode on the windscreen or door frame</p>
      </div>
      <button type="button" onClick={on ? stop : start} className="h-11 rounded-[var(--radius-control)] bg-shadow-800 text-[15px] font-medium text-white hover:bg-shadow-700">
        {on ? "Stop camera" : "Scan VIN barcode"}
      </button>
      {msg && <p className="text-[13px] text-ember-700">{msg}</p>}
    </div>
  );
}
