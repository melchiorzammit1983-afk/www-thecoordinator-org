import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Button } from "@/components/ui/button";

export function QrScanner({ onScan, onClose }: { onScan: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let stop: (() => void) | null = null;
    (async () => {
      try {
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result) => {
            if (!result) return;
            const text = result.getText();
            const now = Date.now();
            if (text === lastRef.current.text && now - lastRef.current.at < 2500) return;
            lastRef.current = { text, at: now };
            onScan(text);
          },
        );
        stop = () => controls.stop();
      } catch (e) {
        setError((e as Error).message || "Camera unavailable");
      }
    })();
    return () => { stop?.(); };
  }, [onScan]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg overflow-hidden bg-black aspect-square">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>Close scanner</Button>
      </div>
    </div>
  );
}
