import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hands-free audio layer for the driver dashboard: short synthesized chimes
 * for dispatch/message events + Web Speech API voice readouts. Everything
 * runs in the browser — no assets, no server calls.
 */

export type ChimeKind = "dispatch" | "message";

type Options = { storageKey?: string };

export function useDriverAudio(opts: Options = {}) {
  const storageKey = opts.storageKey ?? "driver:auto-read";
  const ctxRef = useRef<AudioContext | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoRead, setAutoReadState] = useState<boolean>(false);

  const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const audioSupported = typeof window !== "undefined"
    && (typeof window.AudioContext !== "undefined"
      || typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined");

  // Restore auto-read preference.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "1") setAutoReadState(true);
    } catch { /* ignore quota / privacy mode */ }
  }, [storageKey]);

  const setAutoRead = useCallback((v: boolean) => {
    setAutoReadState(v);
    try { window.localStorage.setItem(storageKey, v ? "1" : "0"); } catch { /* ignore */ }
  }, [storageKey]);

  // Lazy-init a single AudioContext; resume after any user gesture so
  // autoplay policy doesn't swallow the first chime.
  const getCtx = useCallback((): AudioContext | null => {
    if (!audioSupported) return null;
    if (!ctxRef.current) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      try { ctxRef.current = new Ctor(); } catch { return null; }
    }
    const ctx = ctxRef.current;
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }, [audioSupported]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const resume = () => { getCtx(); };
    window.addEventListener("pointerdown", resume, { passive: true });
    window.addEventListener("keydown", resume);
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, [getCtx]);

  const beep = useCallback((ctx: AudioContext, freq: number, startAt: number, duration: number, gain: number, type: OscillatorType) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    g.gain.setValueAtTime(0, startAt);
    g.gain.linearRampToValueAtTime(gain, startAt + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }, []);

  const playChime = useCallback((kind: ChimeKind) => {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    if (kind === "dispatch") {
      // Sharp urgent double-beep.
      beep(ctx, 880, t, 0.09, 0.35, "square");
      beep(ctx, 1320, t + 0.11, 0.09, 0.35, "square");
    } else {
      // Soft single ding.
      beep(ctx, 660, t, 0.35, 0.22, "sine");
      beep(ctx, 990, t, 0.35, 0.10, "sine");
    }
  }, [beep, getCtx]);

  const cancelSpeech = useCallback(() => {
    if (!speechSupported) return;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    setIsSpeaking(false);
  }, [speechSupported]);

  const speak = useCallback((text: string) => {
    if (!speechSupported || !text?.trim()) return;
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = 1.0;
      u.volume = 1.0;
      u.onstart = () => setIsSpeaking(true);
      u.onend = () => setIsSpeaking(false);
      u.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(u);
    } catch { setIsSpeaking(false); }
  }, [speechSupported]);

  useEffect(() => () => { cancelSpeech(); }, [cancelSpeech]);

  return {
    supported: speechSupported || audioSupported,
    speechSupported,
    isSpeaking,
    autoRead,
    setAutoRead,
    playChime,
    speak,
    cancelSpeech,
  };
}
