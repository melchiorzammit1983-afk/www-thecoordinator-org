import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Square, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { aiVoiceNoteToTrip } from "@/lib/coordinator.functions";
import { useFeature, useFeatureCost, usePointsRemaining } from "@/hooks/use-features";

const MAX_BYTES = 20 * 1024 * 1024; // 20MB
const MIN_BYTES = 2 * 1024; // guard against empty recordings
const MAX_RECORDING_MS = 5 * 60 * 1000; // 5 min

export type VoiceTrip = {
  pickupDate: string; pickupTime: string;
  pickupAddress: string; deliveryAddress: string;
  customerName: string; contactNumber: string;
  transportType: string; quantity: string;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const s = String(r.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.readAsDataURL(blob);
  });
}

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const c of candidates) if (MediaRecorder.isTypeSupported(c)) return c;
  return "audio/webm";
}

export function VoiceToTripButton({
  onTrips,
  disabled,
}: {
  onTrips: (trips: VoiceTrip[], transcript: string) => void;
  disabled?: boolean;
}) {
  const enabled = useFeature("ai_voice_to_trip");
  const cost = useFeatureCost("ai_voice_to_trip");
  const remaining = usePointsRemaining();
  const outOfPoints = remaining > 0 && remaining < cost;


  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const voiceFn = useServerFn(aiVoiceNoteToTrip);

  const mut = useMutation({
    mutationFn: (input: { audio_base64: string; mime_type: string }) =>
      voiceFn({ data: input }) as Promise<{ transcript: string; trips: VoiceTrip[] }>,
    onSuccess: (res) => {
      if (!res.trips?.length) {
        toast.error("AI couldn't find any trips in the audio");
        return;
      }
      onTrips(res.trips, res.transcript ?? "");
      toast.success(`Extracted ${res.trips.length} trip${res.trips.length === 1 ? "" : "s"} from voice note`);
    },
    onError: (e: Error) => toast.error(e.message || "Voice extraction failed"),
  });

  const cleanup = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopTimeoutRef.current) { clearTimeout(stopTimeoutRef.current); stopTimeoutRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setElapsed(0);
    setRecording(false);
  };

  useEffect(() => cleanup, []);

  const startRecording = async () => {
    if (mut.isPending || disabled) return;
    if (!enabled) { toast.error("Voice-to-trip isn't enabled on your plan"); return; }
    if (outOfPoints) { toast.error(`Not enough points (needs ${cost})`); return; }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("This browser can't record audio — use the Voice file button instead");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      toast.error("Recording not supported here — use the Voice file button instead");
      return;
    }


    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Microphone permission denied");
      return;
    }
    streamRef.current = stream;
    const mimeType = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      const usedMime = recorder.mimeType || mimeType;
      const blob = new Blob(chunksRef.current, { type: usedMime });
      cleanup();
      if (blob.size < MIN_BYTES) {
        toast.error("Recording was empty — please try again");
        return;
      }
      if (blob.size > MAX_BYTES) {
        toast.error("Recording is too large (max 20MB)");
        return;
      }
      try {
        const audio_base64 = await blobToBase64(blob);
        mut.mutate({ audio_base64, mime_type: usedMime.split(";")[0] });
      } catch {
        toast.error("Couldn't read recording");
      }
    };
    recorder.start();
    setRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    stopTimeoutRef.current = setTimeout(() => {
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    }, MAX_RECORDING_MS);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  };

  const onUpload = async (file: File) => {
    if (mut.isPending) return;
    if (!enabled) { toast.error("Voice-to-trip isn't enabled on your plan"); return; }
    if (outOfPoints) { toast.error(`Not enough points (needs ${cost})`); return; }
    if (!file.type.startsWith("audio/")) {
      toast.error("Please choose an audio file");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File is too large (max 20MB)");
      return;
    }

    try {
      const audio_base64 = await blobToBase64(file);
      mut.mutate({ audio_base64, mime_type: file.type.split(";")[0] });
    } catch {
      toast.error("Couldn't read file");
    }
  };

  const tip = !enabled
    ? "Voice-to-trip isn't in your plan"
    : outOfPoints
    ? `Out of points (needs ${cost})`
    : `Costs ${cost} point${cost === 1 ? "" : "s"} per use`;

  const busy = mut.isPending;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (!enabled) return null;

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onUpload(f);
          e.target.value = "";
        }}
      />

      {recording ? (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="h-7 gap-1.5"
          onClick={stopRecording}
        >
          <Square className="h-3 w-3 fill-current" />
          Stop {fmt(elapsed)}
          <span className="ml-1 inline-block h-2 w-2 rounded-full bg-white animate-pulse" />
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          disabled={busy || disabled}
          onClick={startRecording}
          title={tip}
        >
          {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Mic className="h-3 w-3 mr-1" />}
          {busy ? "Extracting…" : "Record"}
        </Button>
      )}

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7"
        disabled={busy || recording || disabled}
        onClick={() => fileInputRef.current?.click()}
        title={tip}
      >
        <Upload className="h-3 w-3 mr-1" />
        Voice file
      </Button>

      {elapsed > 240 && recording && (
        <span className="text-xs text-amber-600">approaching 5 min limit</span>
      )}
    </div>
  );
}
