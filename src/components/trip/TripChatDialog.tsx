import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Send } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { listTripMessages, postTripMessage } from "@/lib/coordinator-public.functions";
import { listTripMessagesCoord, postTripMessageCoord } from "@/lib/coordinator.functions";

type Msg = {
  id: string;
  sender_kind: "driver" | "coordinator" | "client";
  sender_label: string | null;
  body: string;
  created_at: string;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string | null;
  title?: string;
  role: "driver" | "coordinator";
  token?: string; // required for driver
};

export function TripChatDialog({ open, onOpenChange, jobId, title, role, token }: Props) {
  const qc = useQueryClient();
  const listDrv = useServerFn(listTripMessages);
  const postDrv = useServerFn(postTripMessage);
  const listCoord = useServerFn(listTripMessagesCoord);
  const postCoord = useServerFn(postTripMessageCoord);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const queryKey = ["trip-messages", role, jobId, token ?? ""];
  const { data: messages } = useQuery({
    queryKey,
    enabled: !!open && !!jobId,
    refetchInterval: open ? 10_000 : false,
    queryFn: () => role === "driver"
      ? listDrv({ data: { token: token!, job_id: jobId! } }) as Promise<Msg[]>
      : listCoord({ data: { job_id: jobId! } }) as Promise<Msg[]>,
  });

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const postMut = useMutation({
    mutationFn: (body: string) => role === "driver"
      ? postDrv({ data: { token: token!, job_id: jobId!, body } })
      : postCoord({ data: { job_id: jobId!, body } }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["driver-manifest"] });
      qc.invalidateQueries({ queryKey: ["coord-unread"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit() {
    const body = text.trim();
    if (!body) return;
    postMut.mutate(body);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-base">Trip chat</DialogTitle>
          <DialogDescription className="text-xs truncate">{title ?? "Messages for this trip"}</DialogDescription>
        </DialogHeader>
        <div ref={scrollRef} className="max-h-[55vh] min-h-[240px] overflow-y-auto px-3 py-3 space-y-2 bg-muted/30">
          {(messages ?? []).length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-8">No messages yet. Start the conversation.</p>
          )}
          {(messages ?? []).map((m) => {
            const mine = m.sender_kind === role;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`rounded-2xl px-3 py-2 max-w-[80%] text-sm shadow-sm ${mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-background border rounded-bl-sm"}`}>
                  <div className={`text-[10px] uppercase tracking-wide mb-0.5 ${mine ? "opacity-70" : "text-muted-foreground"}`}>
                    {m.sender_label ?? m.sender_kind} · {new Date(m.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t p-2 flex gap-2 items-end bg-background">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder="Type a message…"
            rows={2}
            className="resize-none"
          />
          <Button size="icon" onClick={submit} disabled={postMut.isPending || !text.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
