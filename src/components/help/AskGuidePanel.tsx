"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Send, Sparkles, RotateCcw, Loader2, LifeBuoy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAskGuide } from "./AskGuideProvider";
import { logHelpQuestion, createSupportTicket, analyzeHelpTurn } from "@/lib/support.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "coord.help-chat.v1";

function loadHistory(): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch { return []; }
}

const SUGGESTIONS = [
  "Why is my trip card glowing red?",
  "How does the AI trip extraction work?",
  "What starts the waiting-time meter?",
  "What happens when I override a driver's status?",
];

export function AskGuidePanel() {
  const { isOpen, ctx, close } = useAskGuide();
  const [initial] = useState<UIMessage[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/help-chat",
        body: () => ({ context: ctx?.systemContext ?? undefined }),
        headers: async () => {
          const { supabase } = await import("@/integrations/supabase/client");
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    [ctx?.systemContext],
  );


  const { messages, sendMessage, status, error, setMessages } = useChat({
    id: "help-guide",
    messages: initial,
    transport,
  });

  const logFn = useServerFn(logHelpQuestion);
  const escalateFn = useServerFn(createSupportTicket);
  const analyzeFn = useServerFn(analyzeHelpTurn);
  const navigate = useNavigate();
  const [lastLoggedId, setLastLoggedId] = useState<string | null>(null);
  const [showEscalate, setShowEscalate] = useState(false);
  const [escSubject, setEscSubject] = useState("");
  const [turnMeta, setTurnMeta] = useState<{ confidence: number; clarifying: string[]; escalate: boolean; suggested_subject: string | null } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const loggedForRef = useRef<string | null>(null);
  const analyzedForRef = useRef<string | null>(null);

  // Persist history
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // Log Q&A + analyze confidence/clarifying/escalation when assistant finishes a response
  useEffect(() => {
    if (status !== "ready" || messages.length < 2) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    if (loggedForRef.current === last.id) return;
    const prevUser = [...messages].reverse().find((m) => m.role === "user");
    if (!prevUser) return;
    const q = prevUser.parts.map((p) => (p.type === "text" ? p.text : "")).join("").trim();
    const a = last.parts.map((p) => (p.type === "text" ? p.text : "")).join("").trim();
    if (!q || !a) return;
    loggedForRef.current = last.id;
    logFn({ data: { question: q, answer: a, route: typeof window !== "undefined" ? window.location.pathname : undefined } })
      .then((r) => setLastLoggedId(r.id))
      .catch(() => {});

    if (analyzedForRef.current === last.id) return;
    analyzedForRef.current = last.id;
    setAnalyzing(true);
    const thread = messages.map((m) => ({ role: m.role, text: m.parts.map((p) => (p.type === "text" ? p.text : "")).join("") }));
    analyzeFn({ data: { question: q, answer: a, thread } })
      .then((meta) => setTurnMeta(meta))
      .catch(() => {})
      .finally(() => setAnalyzing(false));
  }, [status, messages, logFn, analyzeFn]);

  // Reset per-turn UI when the user sends a new message
  useEffect(() => {
    if (status === "submitted") setTurnMeta(null);
  }, [status]);

  // Autoscroll
  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, status]);

  // Prefill from context
  useEffect(() => {
    if (!isOpen) return;
    if (ctx?.prefill) setInput(ctx.prefill);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen, ctx]);

  if (!isOpen) return null;

  const busy = status === "submitted" || status === "streaming";

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  };

  const clear = () => {
    setMessages([]);
    setLastLoggedId(null);
    loggedForRef.current = null;
    try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
  };

  const submitEscalation = async () => {
    const subject = escSubject.trim() || turnMeta?.suggested_subject || (messages.find((m) => m.role === "user")?.parts.map((p) => (p.type === "text" ? p.text : "")).join("").slice(0, 80) ?? "Guide couldn't help");
    const thread = messages.map((m) => ({ role: m.role, text: m.parts.map((p) => (p.type === "text" ? p.text : "")).join("") }));
    try {
      const { id } = await escalateFn({ data: {
        subject,
        body: "Escalated from Ask the Guide. Full conversation attached.",
        route: typeof window !== "undefined" ? window.location.pathname : undefined,
        viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : undefined,
        ai_thread: thread,
        from_log_id: lastLoggedId ?? undefined,
      } });
      toast.success("Ticket created — an admin will follow up.");
      setShowEscalate(false);
      close();
      navigate({ to: "/my-tickets" });
      void id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create ticket");
    }
  };


  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
        onClick={close}
      />
      <div className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-md flex-col border-l border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Ask the Guide</div>
              <div className="text-xs text-muted-foreground">AI-powered · knows your system</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length >= 2 && (
              <button
                onClick={() => setShowEscalate(true)}
                title="Ask a human"
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <LifeBuoy className="h-4 w-4" />
              </button>
            )}
            {messages.length > 0 && (
              <button
                onClick={clear}
                title="New conversation"
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={close}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium text-foreground">Hi 👋</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  I'm the built-in guide for The Coordinator. Ask me how a feature
                  works, or why something on your screen looks the way it does.
                </p>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Try one of these
                </div>
                <div className="grid gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setInput(s); setTimeout(submit, 0); }}
                      className="rounded-md border border-border px-3 py-2 text-left text-sm text-foreground hover:border-primary hover:bg-primary/5"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m) => (
                <ChatMessage key={m.id} message={m} />
              ))}
              {status === "submitted" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                </div>
              )}
              {status === "ready" && analyzing && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Checking if I fully answered you…
                </div>
              )}
              {status === "ready" && turnMeta && turnMeta.clarifying.length > 0 && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
                    Help me help you — pick one
                  </div>
                  <div className="grid gap-1.5">
                    {turnMeta.clarifying.map((q) => (
                      <button
                        key={q}
                        onClick={() => { setInput(q); setTimeout(submit, 0); }}
                        className="rounded-md border border-primary/30 bg-background px-3 py-2 text-left text-sm text-foreground hover:border-primary hover:bg-primary/10"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {status === "ready" && turnMeta?.escalate && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="flex items-start gap-2">
                    <LifeBuoy className="mt-0.5 h-4 w-4 text-amber-600" />
                    <div className="flex-1 text-xs text-foreground">
                      <div className="font-semibold">I'm not fully confident I solved this.</div>
                      <p className="mt-0.5 text-muted-foreground">
                        Want me to send this conversation to an admin so a human can take over?
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            if (turnMeta.suggested_subject) setEscSubject(turnMeta.suggested_subject);
                            setShowEscalate(true);
                          }}
                        >
                          Escalate to admin
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setTurnMeta({ ...turnMeta, escalate: false })}>
                          Not now
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {error && (
            <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
              {String(error.message ?? error)}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border p-3">
          <div className="relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
              }}
              placeholder="Ask about anything you see on screen…"
              rows={2}
              disabled={busy}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 pr-11 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
            />
            <button
              onClick={submit}
              disabled={!input.trim() || busy}
              className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="mt-1.5 text-[10px] text-muted-foreground">
            Answers are AI-generated. Double-check anything important.
          </div>
        </div>
      </div>
      {showEscalate && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4" onClick={() => setShowEscalate(false)}>
          <div className="w-full max-w-sm rounded-lg bg-background border p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold text-sm flex items-center gap-2"><LifeBuoy className="h-4 w-4 text-primary" /> Escalate to admin</div>
            <p className="text-xs text-muted-foreground">Your full Guide conversation and current screen will be attached so an admin can help.</p>
            <Input placeholder="Short subject (optional)" value={escSubject} onChange={(e) => setEscSubject(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowEscalate(false)}>Cancel</Button>
              <Button size="sm" onClick={submitEscalation}>Create ticket</Button>
            </div>
          </div>
        </div>
      )}
    </>

  );
}

function ChatMessage({ message }: { message: UIMessage }) {
  const text = message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className={cn("prose prose-sm max-w-none text-foreground",
      "prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground",
      "prose-a:text-primary prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
      "prose-li:my-0.5",
    )}>
      <ReactMarkdown>{text || "…"}</ReactMarkdown>
    </div>
  );
}
