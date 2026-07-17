"use client";
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type AskGuideContext = {
  prefill?: string;
  systemContext?: string; // e.g. "User is looking at trip #A123"
};

type Ctx = {
  isOpen: boolean;
  ctx: AskGuideContext | null;
  open: (ctx?: AskGuideContext) => void;
  close: () => void;
};

const AskGuideCtx = createContext<Ctx | null>(null);

export function AskGuideProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [ctx, setCtx] = useState<AskGuideContext | null>(null);
  const open = useCallback((c?: AskGuideContext) => { setCtx(c ?? null); setOpen(true); }, []);
  const close = useCallback(() => setOpen(false), []);
  return (
    <AskGuideCtx.Provider value={{ isOpen, ctx, open, close }}>
      {children}
    </AskGuideCtx.Provider>
  );
}

export function useAskGuide() {
  const v = useContext(AskGuideCtx);
  if (!v) return { isOpen: false, ctx: null, open: () => {}, close: () => {} } as Ctx;
  return v;
}
