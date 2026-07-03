import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Send, Users, User, Headphones } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
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
  identityId?: string | null;
  paxId?: string | null;
  threadKind?: "all" | "private" | "group" | "driver";
  paxName?: string | null;
};

type DriverTab = "group" | "driver_client" | "driver_coord";

export function TripChatDialog({ open, onOpenChange, jobId, title, role, token, identityId, paxId, threadKind, paxName }: Props) {
  const qc = useQueryClient();
  const listDrv = useServerFn(listTripMessages);
  const postDrv = useServerFn(postTripMessage);
  const listCoord = useServerFn(listTripMessagesCoord);
  const postCoord = useServerFn(postTripMessageCoord);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [driverTab, setDriverTab] = useState<DriverTab>("group");

  const effectiveThread: "all" | "private" | "group" | "driver" =
    role === "coordinator" ? (threadKind ?? ((identityId || paxId) ? "private" : "all")) : "all";

  const queryKey = ["trip-messages", role, jobId, token ?? "", identityId ?? "", paxId ?? "", effectiveThread, driverTab];
  const { data: messages } = useQuery({
    queryKey,
    enabled: !!open && !!jobId,
    refetchInterval: open ? 10_000 : false,
    queryFn: () => role === "driver"
      ? listDrv({ data: { token: token!, job_id: jobId!, thread_kind: driverTab } }) as Promise<Msg[]>
      : listCoord({ data: { job_id: jobId!, identity_id: identityId ?? null, pax_id: paxId ?? null, thread_kind: effectiveThread } }) as Promise<Msg[]>,
  });

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const postMut = useMutation({
    mutationFn: (body: string) => role === "driver"
      ? postDrv({ data: { token: token!, job_id: jobId!, body, thread_kind: driverTab } })
      : effectiveThread === "driver"
        ? postCoord({ data: { job_id: jobId!, body, thread_kind: "driver" } })
        : postCoord({ data: {
            job_id: jobId!, body,
            identity_id: effectiveThread === "private" ? (identityId ?? null) : null,
            pax_id: effectiveThread === "private" ? (paxId ?? null) : null,
            thread_kind: effectiveThread === "private" ? "private" : "group",
          } }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["driver-manifest"] });
      qc.invalidateQueries({ queryKey: ["coord-unread"] });
      qc.invalidateQueries({ queryKey: ["pax-activity"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit() {
    const body = text.trim();
    if (!body) return;
    postMut.mutate(body);
  }

  const headerSubtitle = role === "driver"
    ? (driverTab === "driver_client"
        ? "Private with the client — coordinator does not see this."
        : driverTab === "driver_coord"
          ? "Private with the coordinator — client does not see this."
          : (title ?? "Group thread — everyone on this trip sees this."))
    : effectiveThread === "driver"
      ? "Private with the driver — client does not see this."
      : paxName
        ? (identityId ? "Private thread · only this passenger sees your replies" : "Passenger hasn't picked their name yet — showing group thread")
        : (title ?? "Messages for this trip");

  const headerTitle = role === "coordinator" && effectiveThread === "driver"
    ? "Driver chat"
    : paxName ? `Chat with ${paxName}` : "Trip chat";

  const placeholder = role === "driver"
    ? (driverTab === "driver_client" ? "Message the client privately…"
      : driverTab === "driver_coord" ? "Message the coordinator privately…"
      : "Message the group…")
    : effectiveThread === "driver" ? "Message the driver privately…"
    : "Type a message…";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-base">{headerTitle}</DialogTitle>
          <DialogDescription className="text-xs truncate">{headerSubtitle}</DialogDescription>
        </DialogHeader>

        {role === "driver" && (
          <div className="grid grid-cols-3 gap-1 rounded-none bg-muted/40 p-1 border-b">
            {([
              { id: "group", label: "Group", Icon: Users },
              { id: "driver_client", label: "Client", Icon: User },
              { id: "driver_coord", label: "Coordinator", Icon: Headphones },
            ] as { id: DriverTab; label: string; Icon: typeof Users }[]).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setDriverTab(id)}
                className={cn(
                  "rounded-md py-1.5 text-xs font-medium flex items-center justify-center gap-1.5",
                  driverTab === id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        )}

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
            placeholder={placeholder}
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
