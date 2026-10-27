"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./camerascan.module.css";

/**
 * "Scan with camera": reads barcodes (lines) and QR codes with the phone's back camera, so a phone can
 * do the scanner gun's job. Works on Android (Chrome) and iPhone (Safari) over HTTPS.
 *
 * - `multiple`: keeps the camera open and adds every new code it sees (Send, Receive, bulk add, search).
 *   Otherwise the first code is used and the camera closes (single Add forms, batch receipt field).
 * - Each code is handed to `onScan` exactly as a scanner gun would type it, so the existing checks run.
 *
 * Android Chrome has a built-in barcode reader, which is used when present. iPhone has none, so the
 * `barcode-detector` library (ZXing) is loaded only when the camera opens.
 */

// Labels in use: QR codes on mobiles and receipts, Code 128 / Code 39 style barcodes on SD cards and rigs.
const FORMATS = [
  "qr_code",
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
  "data_matrix",
  "pdf417",
];
const SCAN_EVERY_MS = 120;
// The same code seen again within this time is the camera still looking at it, not a new scan.
const SAME_CODE_MS = 2500;

type Detected = { rawValue: string };
type Detector = { detect: (source: HTMLVideoElement) => Promise<Detected[]> };
type NativeDetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

let detectorPromise: Promise<Detector> | null = null;

async function makeDetector(): Promise<Detector> {
  const Native = (globalThis as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      const supported = new Set(await (Native.getSupportedFormats?.() ?? Promise.resolve([] as string[])));
      if (supported.has("qr_code") && supported.has("code_128")) {
        return new Native({ formats: FORMATS.filter((f) => supported.has(f)) });
      }
    } catch {
      // Fall back to the library below.
    }
  }
  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  return new BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector;
}

function getDetector(): Promise<Detector> {
  detectorPromise ??= makeDetector().catch((error) => {
    detectorPromise = null; // let the next try load it again (e.g. after a network blip)
    throw error;
  });
  return detectorPromise;
}

/** Adds a code to a one-per-line list, the way a scanner gun ending with Enter would. */
export function appendLine(text: string, code: string): string {
  const base = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return `${base}${code}\n`;
}

function cameraError(error: unknown): string {
  const name = (error as { name?: string })?.name ?? "";
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "The camera only works on the https:// address of the app.";
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access is blocked. Allow the camera for this site in your browser settings, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is being used by another app. Close it and try again.";
  return "The camera scanner could not start. Check your internet connection and try again.";
}

export default function CameraScanButton({
  onScan,
  multiple = false,
  label = "Scan with camera",
}: {
  onScan: (code: string) => void;
  multiple?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [last, setLast] = useState<{ code: string; repeat: boolean; at: number } | null>(null);
  const [count, setCount] = useState(0);
  const [torch, setTorch] = useState<boolean | null>(null); // null: this camera has no torch

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const runningRef = useRef(false);
  const seenRef = useRef(new Set<string>());
  const recentRef = useRef(new Map<string, number>());

  // Always call the latest onScan, so codes added while the camera is open build on each other.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const close = useCallback(() => {
    stop();
    setOpen(false);
  }, [stop]);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, close]);

  function beep() {
    try {
      navigator.vibrate?.(60);
      const ctx = audioRef.current;
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 1800;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch {
      // Sound and vibration are only a nicety.
    }
  }

  function handle(codes: string[]) {
    const now = Date.now();
    for (const raw of codes) {
      const code = raw.trim();
      if (!code) continue;
      const seenAt = recentRef.current.get(code);
      recentRef.current.set(code, now);
      if (seenAt !== undefined && now - seenAt < SAME_CODE_MS) continue; // still in view

      if (!multiple) {
        beep();
        onScanRef.current(code);
        close();
        return;
      }
      if (seenRef.current.has(code)) {
        setLast({ code, repeat: true, at: now });
        continue;
      }
      seenRef.current.add(code);
      beep();
      onScanRef.current(code);
      setCount((c) => c + 1);
      setLast({ code, repeat: false, at: now });
      // One new code per frame: the form updates before the next one is added on top of it.
      return;
    }
  }

  async function start() {
    setError("");
    setLast(null);
    setCount(0);
    setTorch(null);
    seenRef.current = new Set();
    recentRef.current = new Map();
    setOpen(true);
    setStarting(true);

    // Created during the tap, so iPhone allows the beep later.
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx && !audioRef.current) audioRef.current = new Ctx();
      void audioRef.current?.resume();
    } catch {
      // No sound then.
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no camera API"), { name: "NotFoundError" });
      const [stream, detector] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        }),
        getDetector(),
      ]);
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      try {
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean; focusMode?: string[] };
        if (caps.torch) setTorch(false);
        if (caps.focusMode?.includes("continuous")) {
          await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet] });
        }
      } catch {
        // Optional camera features.
      }

      const video = videoRef.current;
      if (!video) {
        stop();
        return;
      }
      video.srcObject = stream;
      await video.play();
      setStarting(false);
      runningRef.current = true;

      const tick = async () => {
        if (!runningRef.current) return;
        try {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            const found = await detector.detect(video);
            if (found.length > 0 && runningRef.current) handle(found.map((f) => f.rawValue));
          }
        } catch {
          // A frame that could not be read; try the next one.
        }
        if (runningRef.current) timerRef.current = setTimeout(tick, SCAN_EVERY_MS);
      };
      void tick();
    } catch (e) {
      stop();
      setStarting(false);
      setError(cameraError(e));
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as unknown as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  }

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => void start()}>
        <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
          <path d="M7 8v8M10 8v8M13 8v8M16 8v8" />
        </svg>
        {label}
      </button>

      {open && (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Camera scanner">
          <video ref={videoRef} className={styles.video} playsInline muted autoPlay />
          <div className={styles.frame} aria-hidden />

          <div className={styles.top}>
            <span>{multiple ? "Point at each barcode or QR code" : "Point at the barcode or QR code"}</span>
            {torch !== null && (
              <button type="button" className={styles.ghost} onClick={() => void toggleTorch()}>
                {torch ? "Light off" : "Light on"}
              </button>
            )}
          </div>

          <div className={styles.bottom}>
            {error ? (
              <p className={styles.error}>{error}</p>
            ) : starting ? (
              <p className={styles.status}>Starting camera…</p>
            ) : last ? (
              <p key={last.at} className={last.repeat ? styles.repeat : styles.added}>
                {last.repeat ? "Already scanned: " : "Added: "}
                <code>{last.code}</code>
              </p>
            ) : (
              <p className={styles.status}>Hold steady about a hand’s length away.</p>
            )}
            <div className={styles.actions}>
              {multiple && !error && <span className={styles.count}>{count} scanned</span>}
              {error && (
                <button type="button" className={styles.ghost} onClick={() => void start()}>
                  Try again
                </button>
              )}
              <button type="button" className={styles.done} onClick={close}>
                {multiple && count > 0 ? "Done" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
