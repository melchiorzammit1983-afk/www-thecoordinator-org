/**
 * Browser Web Speech API helpers for the AI assistant.
 * - useSpeechRecognition: mic → text (SpeechRecognition)
 * - speak / cancelSpeak: text → audio (SpeechSynthesis)
 * Both gracefully no-op when the browser lacks support.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type SRConstructor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

function getSRCtor(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return !!getSRCtor();
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function useSpeechRecognition(opts: {
  onFinal: (text: string) => void;
  onError?: (msg: string) => void;
  lang?: string;
}) {
  const { onFinal, onError, lang = "en-US" } = opts;
  const [listening, setListening] = useState(false);
  const [supported] = useState<boolean>(() => isSpeechRecognitionSupported());
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef<string>("");

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* noop */ }
  }, []);

  const start = useCallback(() => {
    const Ctor = getSRCtor();
    if (!Ctor) { onError?.("Voice input not supported in this browser."); return; }
    if (listening) { stop(); return; }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    finalRef.current = "";
    rec.onresult = (ev) => {
      let finalText = "";
      for (let i = 0; i < ev.results.length; i++) {
        const alt = ev.results[i]?.[0];
        if (alt?.transcript) finalText += alt.transcript;
      }
      finalRef.current = finalText.trim();
    };
    rec.onerror = (ev) => {
      onError?.(ev.error || "Voice input error.");
    };
    rec.onend = () => {
      setListening(false);
      const t = finalRef.current.trim();
      if (t) onFinal(t);
    };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { /* already started */ }
  }, [lang, listening, onError, onFinal, stop]);

  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* noop */ } }, []);

  return { supported, listening, start, stop, toggle: start };
}

export function speak(text: string, opts: { lang?: string } = {}): void {
  if (!isSpeechSynthesisSupported()) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(trimmed);
    utter.lang = opts.lang ?? "en-US";
    utter.rate = 1;
    utter.pitch = 1;
    window.speechSynthesis.speak(utter);
  } catch { /* noop */ }
}

export function cancelSpeak(): void {
  if (!isSpeechSynthesisSupported()) return;
  try { window.speechSynthesis.cancel(); } catch { /* noop */ }
}
