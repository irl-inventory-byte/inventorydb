"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./camerascan.module.css";

/**
 * "Scan with camera": reads barcodes (lines) and QR codes with the phone's back camera, so a phone can
 * do the scanner gun's job. Works on Android (Chrome) and iPhone (Safari) over HTTPS.
 *
 * How a session works (`multiple`, the default):
 * - The camera stays open. Each code is handled the moment it is detected: its ID / serial is shown
 *   in large type for a moment, with the result, then the camera is back for the next one.
 * - Up to `max` (10) codes per opening. After the last one the camera closes; open it again for more.
 * - Done (always on screen) closes the camera and goes back to the page.
 * `multiple={false}` takes one code and closes (batch receipt QR).
 *
 * `onScan` may return the result to show (or a promise of it). Codes are handled one at a time, so
 * saves never overlap and each one finishes before the next code is read.
 *
 * Android Chrome has a built-in barcode reader, which is used when present. iPhone has none, so the
 * `barcode-detector` library (ZXing) is loaded only when the camera opens.
 */

/** What to show for one scanned code. */
export type ScanOutcome = {
  id?: string; // the item ID, when it differs from what was scanned (e.g. a phone's IMEI)
  type?: string; // "SD card", "Rig", "Mobile"
  ok: boolean;
  message: string; // "Saved", "Ready to send", "Already in the inventory", …
};

// Labels in use: QR codes on mobiles, SD cards and receipts, Code 128 / Code 39 style barcodes.
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
const SHOW_OK_MS = 1200; // how long a scanned ID stays on screen
const SHOW_BAD_MS = 2200; // a problem stays longer, so it can be read
const SHOW_REPEAT_MS = 1000;
const MAX_PER_OPEN = 10;

const HINT_AFTER_MS = 6000; // no code read for this long: show tips
const CROP_WIDTH = 960; // the aiming box is enlarged to this width before reading (small QR codes on SD cards)
const FULL_WIDTH = 1280; // the whole picture is reduced to this width before reading

type Detected = { rawValue: string };
type Detector = { detect: (source: HTMLCanvasElement | HTMLVideoElement) => Promise<Detected[]> };
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
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  // The scanner engine (zxing_reader.wasm) is copied into public/zxing/ at build time
  // (scripts/copy-zxing-wasm.mjs), so phones load it from this site, not from an outside CDN that a
  // network or content blocker might stop. If it is missing, the library's default CDN is used.
  try {
    const local = await fetch("/zxing/zxing_reader.wasm", { method: "HEAD" });
    if (local.ok) {
      prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `/zxing/${path}` : prefix + path),
        },
      });
    }
  } catch {
    // Use the default location.
  }
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Flash = { code: string; state: "pending" | "ok" | "bad" | "repeat"; outcome?: ScanOutcome };

export default function CameraScanButton({
  onScan,
  onResult,
  multiple = true,
  max = MAX_PER_OPEN,
  label = "Scan with camera",
  onOpen,
  onClose,
}: {
  onScan: (code: string) => void | ScanOutcome | Promise<void | ScanOutcome>;
  onResult?: (code: string, outcome: ScanOutcome) => void; // after each code is handled
  multiple?: boolean;
  max?: number; // codes per opening of the camera
  label?: string;
  onOpen?: () => boolean; // return false to keep the camera closed (e.g. a required field is empty)
  onClose?: (ok: number) => void; // ok = codes with an ok result in this opening
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [count, setCount] = useState(0);
  const [full, setFull] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null); // null: this camera has no torch
  const [hint, setHint] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const runningRef = useRef(false);
  const busyRef = useRef(false); // a code is on screen / being saved: don't read the next one yet
  const seenRef = useRef(new Set<string>());
  const countRef = useRef(0);
  const okRef = useRef(0);
  const openRef = useRef(false);

  // Always call the latest callbacks.
  const onScanRef = useRef(onScan);
  const onResultRef = useRef(onResult);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onScanRef.current = onScan;
    onResultRef.current = onResult;
    onCloseRef.current = onClose;
  }, [onScan, onResult, onClose]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const close = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    stop();
    setOpen(false);
    onCloseRef.current?.(okRef.current);
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

  function tone(ok: boolean) {
    try {
      navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
      const ctx = audioRef.current;
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = ok ? 1800 : 300;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (ok ? 0.09 : 0.25));
    } catch {
      // Sound and vibration are only a nicety.
    }
  }

  /** Show one code, run it, keep it on screen for a moment, then go back to the camera. */
  async function handle(code: string) {
    busyRef.current = true;
    const shownAt = Date.now();

    if (seenRef.current.has(code)) {
      setFlash({ code, state: "repeat" });
      await wait(SHOW_REPEAT_MS);
      setFlash(null);
      busyRef.current = false;
      return;
    }
    seenRef.current.add(code);
    tone(true);

    if (!multiple) {
      void onScanRef.current(code);
      close();
      busyRef.current = false;
      return;
    }

    countRef.current += 1;
    setCount(countRef.current);
    setFlash({ code, state: "pending" });

    let outcome: ScanOutcome;
    try {
      outcome = (await onScanRef.current(code)) || { ok: true, message: "Added" };
    } catch {
      outcome = { ok: false, message: "Could not save. Check the internet connection." };
    }
    if (outcome.ok) okRef.current += 1;
    else tone(false);
    onResultRef.current?.(code, outcome);
    if (!openRef.current) return; // closed while saving

    setFlash({ code, state: outcome.ok ? "ok" : "bad", outcome });
    const last = countRef.current >= max;
    if (last) setFull(true);
    await wait(Math.max(0, (outcome.ok ? SHOW_OK_MS : SHOW_BAD_MS) - (Date.now() - shownAt)));
    if (!openRef.current) return;

    if (last) {
      close();
      return;
    }
    setFlash(null);
    busyRef.current = false;
  }

  async function start() {
    if (onOpen && onOpen() === false) return;
    setError("");
    setFlash(null);
    setFull(false);
    setTorch(null);
    setCount(0);
    setHint("");
    seenRef.current = new Set();
    countRef.current = 0;
    okRef.current = 0;
    busyRef.current = false;
    openRef.current = true;
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
      if (!openRef.current) {
        stream.getTracks().forEach((t) => t.stop()); // Done was tapped while starting
        return;
      }
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

      // Each round reads the aiming box enlarged (best for small codes), then the whole picture
      // (codes held off-centre). Done on a canvas, so the phone works on a smaller image.
      let round = 0;
      let lastRead = Date.now();
      let failures = 0;
      const tick = async () => {
        if (!runningRef.current) return;
        try {
          if (!busyRef.current && video.readyState >= 2 && video.videoWidth > 0) {
            const source = snapshot(video, round++ % 2 === 0);
            const found = await detector.detect(source);
            failures = 0;
            const code = found.map((f) => f.rawValue.trim()).find(Boolean);
            if (code && runningRef.current && !busyRef.current) {
              lastRead = Date.now();
              setHint("");
              void handle(code);
            } else if (Date.now() - lastRead > HINT_AFTER_MS) {
              setHint("Can't read a code yet. Move closer so the code fills the box, keep it flat and still, or turn the light on.");
            }
          } else if (busyRef.current) {
            lastRead = Date.now();
          }
        } catch {
          failures += 1;
          if (failures === 15) setHint("The scanner is having trouble reading the camera. Close it and open it again.");
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

  /** The picture to read: the aiming box enlarged (`crop`), or the whole picture made smaller. */
  function snapshot(video: HTMLVideoElement, crop: boolean): HTMLCanvasElement | HTMLVideoElement {
    const canvas = (canvasRef.current ??= document.createElement("canvas"));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return video;
    const W = video.videoWidth;
    const H = video.videoHeight;
    let sx = 0;
    let sy = 0;
    let sw = W;
    let sh = H;
    const box = frameRef.current?.getBoundingClientRect();
    const view = video.getBoundingClientRect();
    if (crop && box && view.width > 0 && view.height > 0) {
      // The video fills the screen with object-fit: cover, so map the box from screen to video pixels.
      const scale = Math.max(view.width / W, view.height / H);
      const offX = (view.width - W * scale) / 2;
      const offY = (view.height - H * scale) / 2;
      const pad = 0.15; // a little around the box, in case the code sticks out
      const bw = box.width * (1 + pad);
      const bh = box.height * (1 + pad);
      const bx = box.left - view.left - (bw - box.width) / 2;
      const by = box.top - view.top - (bh - box.height) / 2;
      sx = Math.max(0, (bx - offX) / scale);
      sy = Math.max(0, (by - offY) / scale);
      sw = Math.min(W - sx, bw / scale);
      sh = Math.min(H - sy, bh / scale);
    }
    if (sw < 16 || sh < 16) return video;
    const target = crop ? CROP_WIDTH : Math.min(FULL_WIDTH, W);
    const k = target / sw;
    canvas.width = Math.round(sw * k);
    canvas.height = Math.round(sh * k);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
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

  const flashClass =
    flash?.state === "ok"
      ? styles.flashOk
      : flash?.state === "bad"
        ? styles.flashBad
        : flash?.state === "repeat"
          ? styles.flashRepeat
          : styles.flashWait;

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
          <div ref={frameRef} className={styles.frame} aria-hidden />

          <div className={styles.top}>
            <span className={styles.counter}>
              {multiple ? `${count} / ${max} scanned` : "Scan the receipt QR"}
            </span>
            {torch !== null && (
              <button type="button" className={styles.ghost} onClick={() => void toggleTorch()}>
                {torch ? "Light off" : "Light on"}
              </button>
            )}
            <button type="button" className={styles.done} onClick={close}>
              Done
            </button>
          </div>

          {flash && (
            <div className={`${styles.flash} ${flashClass}`} role="status" aria-live="assertive">
              <span className={styles.flashMark} aria-hidden>
                {flash.state === "ok" ? "✓" : flash.state === "bad" ? "✕" : flash.state === "repeat" ? "•" : "…"}
              </span>
              <code className={styles.flashCode}>{flash.outcome?.id ?? flash.code}</code>
              {flash.outcome?.type && <span className={styles.type}>{flash.outcome.type}</span>}
              <span className={styles.flashMsg}>
                {flash.state === "pending"
                  ? "Checking…"
                  : flash.state === "repeat"
                    ? "Already scanned"
                    : flash.outcome?.message}
              </span>
              {full && <span className={styles.flashMsg}>{max} scanned. Open the camera again to scan more.</span>}
            </div>
          )}

          <div className={styles.bottom}>
            {error ? (
              <p className={styles.error}>{error}</p>
            ) : starting ? (
              <p className={styles.status}>Starting camera…</p>
            ) : hint && !flash ? (
              <p className={styles.hint}>{hint}</p>
            ) : (
              <p className={styles.status}>
                {multiple
                  ? `Point at a barcode or QR code. Each one is added automatically, up to ${max} at a time.`
                  : "Point at the QR code on the receipt."}
              </p>
            )}
            {error && (
              <button type="button" className={styles.ghost} onClick={() => void start()}>
                Try again
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
