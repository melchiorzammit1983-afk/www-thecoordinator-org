import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, Send, X, Sparkles, Loader2 } from "lucide-react";
import { askSalesBot } from "@/lib/sales-bot.functions";

type Msg = { role: "user" | "assistant"; content: string };

const YELLOW = "#FFD700";
const BLACK = "#0F0F0F";

const WELCOME: Msg = {
  role: "assistant",
  content:
    "Hey 👋 I'm the Coordinators assistant. Ask me anything about how the platform works, pricing, the AI dispatcher, or what your team would get out of it. Ready when you are.",
};

export function SalesChatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const ask = useServerFn(askSalesBot);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || pending) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setPending(true);
    try {
      const history = next.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const res = await ask({ data: { messages: history } });
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry — I couldn't reach the assistant just now. Please try again, or book a demo at /request-access.",
        },
      ]);
    } finally {
      setPending(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* Floating trigger */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[60] inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-bold shadow-2xl transition-transform hover:-translate-y-0.5"
          style={{
            backgroundColor: YELLOW,
            color: BLACK,
            boxShadow: `0 10px 30px ${YELLOW}55`,
          }}
          aria-label="Open sales chat"
        >
          <MessageCircle className="h-4 w-4" />
          <span className="hidden sm:inline">Ask us anything</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-5 right-5 z-[60] flex flex-col overflow-hidden rounded-2xl border shadow-2xl"
          style={{
            width: "min(380px, calc(100vw - 2rem))",
            height: "min(560px, calc(100vh - 2rem))",
            backgroundColor: BLACK,
            borderColor: YELLOW,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ backgroundColor: "#1A1A1A", borderColor: `${YELLOW}55` }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="grid h-8 w-8 place-items-center rounded-lg"
                style={{ backgroundColor: YELLOW, color: BLACK }}
              >
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">Coordinators assistant</div>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: YELLOW }}>
                  Online · asks and answers
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1.5 text-white/70 hover:bg-white/10"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5"
            style={{ backgroundColor: BLACK }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"
                  }`}
                  style={
                    m.role === "user"
                      ? { backgroundColor: YELLOW, color: BLACK }
                      : { backgroundColor: "#1A1A1A", color: "#F5F5F5", border: `1px solid ${YELLOW}33` }
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {pending && (
              <div className="flex justify-start">
                <div
                  className="rounded-2xl rounded-bl-sm px-3 py-2 text-sm inline-flex items-center gap-2"
                  style={{ backgroundColor: "#1A1A1A", color: "#F5F5F5", border: `1px solid ${YELLOW}33` }}
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Thinking…
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div
            className="border-t p-2.5"
            style={{ borderColor: `${YELLOW}55`, backgroundColor: "#1A1A1A" }}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="Ask about pricing, the AI assistant, driver setup…"
                className="flex-1 resize-none rounded-lg border bg-black px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1"
                style={{ borderColor: `${YELLOW}55` }}
                maxLength={2000}
              />
              <button
                type="button"
                onClick={send}
                disabled={pending || !input.trim()}
                className="grid h-9 w-9 place-items-center rounded-lg font-bold transition-colors disabled:opacity-40"
                style={{ backgroundColor: YELLOW, color: BLACK }}
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1.5 text-[10px] text-white/40">
              AI assistant · answers are general. For anything specific, book a demo.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
