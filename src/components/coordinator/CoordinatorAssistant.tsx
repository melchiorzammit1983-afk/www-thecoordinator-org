"use client";
/**
 * AI Coordinator Assistant — floating FAB + slide-in chat panel.
 *
 * Text-only. Answers questions or drafts a single trip create/edit as a
 * proposal card. On Confirm, it reuses the existing createJob / updateJob
 * server functions — the assistant itself never writes to the DB.
 *
 * Scope this pass (per product spec): no voice, no bulk actions, no learning
 * table, no driver-conflict detection. Metered via the general points system.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Sparkles, X, Send, Loader2, Bot, User as UserIcon, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useSpeechRecognition, speak, cancelSpeak, isSpeechSynthesisSupported } from "@/hooks/use-voice";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { askCoordinatorAssistant, getJobForAssistant, meterAssistantConfirm, stageAssistantActions, type AssistantResult, type AssistantDraft, type AssistantBatch, type AssistantDataFix, type AssistantPartnerSuggest, type AssistantCommandActions, type AssistantMergeTrips } from "@/lib/coordinator-assist.functions";
import { logAssistantAction } from "@/lib/assistant-learning.functions";
import { recordAiAuditAction } from "@/lib/ai-audit.functions";
import { createJob, updateJob, updateDriverBasic, applyAiCommandActions, mergeTrips } from "@/lib/coordinator.functions";
import { dispatchJobToPartner } from "@/lib/collab.functions";
import { useFeature } from "@/hooks/use-features";
import { useAiToggle } from "@/hooks/use-preferences";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

// ---------------- Screen context ----------------

export type AssistantScreen = {
  path?: string | null;
  trip?: {
    id: string;
    trip_no?: number | null;
    from_location?: string | null;
    to_location?: string | null;
    date?: string | null;
    time?: string | null;
    driver_id?: string | null;
    driver_name?: string | null;
    from_flight?: string | null;
    to_flight?: string | null;
    vehicle?: string | null;
    contact_phone?: string | null;
    clientcompanyname?: string | null;
    pax?: string[] | null;
  } | null;
};

// ---- Passenger-parse warning helpers (mirror server-side codes) ----
function paxWarningLabel(w: string): string {
  const [, ...rest] = w.split(":");
  return rest.join(":").trim() || w;
}
function hasBlockingPaxWarning(warnings?: string[] | null): boolean {
  if (!warnings?.length) return false;
  return warnings.some((w) => w.startsWith("no_pax_extracted") || w.startsWith("count_mismatch"));
}

type AssistantCtx = {
  setScreen: (s: AssistantScreen | null) => void;
  screenRef: React.MutableRefObject<AssistantScreen | null>;
  openPanel: (s?: AssistantScreen | null) => void;
};
const Ctx = createContext<AssistantCtx | null>(null);

/**
 * Register the trip/screen the coordinator is currently looking at so the
 * assistant can resolve "this trip". Safe to call from anywhere below the
 * provider — no-ops otherwise. Cleans up on unmount.
 */
export function useSetAssistantScreen(screen: AssistantScreen | null) {
  const ctx = useContext(Ctx);
  useEffect(() => {
    if (!ctx) return;
    ctx.setScreen(screen);
    return () => {
      // Only clear if we still own the context (avoid clobbering a sibling).
      if (ctx.screenRef.current === screen) ctx.setScreen(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, JSON.stringify(screen)]);
}

/**
 * Open the assistant panel. Optionally passes a one-shot screen context
 * (e.g. "this trip") so the coordinator can immediately ask about it.
 */
export function useOpenAssistant(): (screen?: AssistantScreen | null) => void {
  const ctx = useContext(Ctx);
  return ctx?.openPanel ?? (() => {});
}

// ---------------- Chat state ----------------

type ChatMsg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string }
  | { id: string; role: "assistant"; draft: AssistantDraft; rawMessage?: string }
  | { id: string; role: "assistant"; batch: AssistantBatch; rawMessage?: string }
  | { id: string; role: "assistant"; fix: AssistantDataFix; rawMessage?: string }
  | { id: string; role: "assistant"; suggest: AssistantPartnerSuggest; rawMessage?: string }
  | { id: string; role: "assistant"; merge: AssistantMergeTrips; rawMessage?: string; applied?: boolean }
  | {
      id: string;
      role: "assistant";
      actions: AssistantCommandActions;
      rawMessage?: string;
      selected: boolean[]; // per action
      applied?: boolean;
      results?: Array<{ index: number; ok: boolean; message: string }>;
    };

function draftFieldSummary(fields: AssistantDraft["fields"]): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const push = (label: string, v?: string | null) => {
    if (v != null && String(v).trim() !== "") out.push({ label, value: String(v) });
  };
  push("From", fields.from_location);
  push("To", fields.to_location);
  push("Date", fields.date);
  push("Time", fields.time);
  push("Driver", fields.driver_name ?? (fields.driver_id ? "(assigned)" : undefined));
  push("Vehicle", fields.vehicle);
  push("Phone", fields.contact_phone);
  push("From flight", fields.from_flight);
  push("To flight", fields.to_flight);
  push("Client", fields.clientcompanyname);
  const pax = fields.pax ?? [];
  if (pax.length > 0) out.push({ label: `Passengers (${pax.length})`, value: pax.join(", ") });
  return out;
}

// ---------------- Provider + FAB + Panel ----------------

export function CoordinatorAssistant({ children }: { children: ReactNode }) {
  const featureOn = useFeature("ai_coordinator_assist");
  const userOn = useAiToggle("assistant_fab");
  const enabled = featureOn && userOn;
  const [screen, setScreenState] = useState<AssistantScreen | null>(null);
  const screenRef = useRef<AssistantScreen | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const setScreen = useCallback((s: AssistantScreen | null) => {
    screenRef.current = s;
    setScreenState(s);
  }, []);
  const openPanel = useCallback((s?: AssistantScreen | null) => {
    if (s !== undefined) {
      screenRef.current = s;
      setScreenState(s);
    }
    setPanelOpen(true);
  }, []);

  const ctxValue = useMemo<AssistantCtx>(() => ({ setScreen, screenRef, openPanel }), [setScreen, openPanel]);

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
      {enabled ? <AssistantSurface screen={screen} open={panelOpen} setOpen={setPanelOpen} /> : null}
    </Ctx.Provider>
  );
}

function AssistantSurface({ screen, open, setOpen }: { screen: AssistantScreen | null; open: boolean; setOpen: (v: boolean) => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const askFn = useServerFn(askCoordinatorAssistant);
  const getJobFn = useServerFn(getJobForAssistant);
  const createFn = useServerFn(createJob);
  const updateFn = useServerFn(updateJob);
  const updateDriverFn = useServerFn(updateDriverBasic);
  const mergeFn = useServerFn(mergeTrips);
  const meterFn = useServerFn(meterAssistantConfirm);
  const logFn = useServerFn(logAssistantAction);
  const qc = useQueryClient();
  const auditFn = useServerFn(recordAiAuditAction);
  const logAudit = useCallback(
    (args: {
      action_kind: "create" | "update" | "search_update" | "data_fix" | "group" | "ungroup" | "message" | "partner_suggest";
      target_table: string;
      target_id?: string | null;
      target_ids?: string[] | null;
      before_state?: unknown;
      after_state?: unknown;
      summary?: string | null;
      raw_message?: string | null;
    }) => {
      void auditFn({ data: args }).catch(() => { /* silent — must not break confirm */ });
    },
    [auditFn],
  );
  const lastUserMsgRef = useRef<string>("");
  const logLearning = useCallback(
    (args: {
      action_kind: "draft" | "batch" | "search_update" | "data_fix" | "partner_suggest";
      outcome: "confirmed" | "edited_then_confirmed" | "cancelled" | "skipped";
      proposed: unknown;
      final?: unknown;
      raw_message?: string | null;
    }) => {
      void logFn({
        data: {
          action_kind: args.action_kind,
          outcome: args.outcome,
          proposed_payload: args.proposed,
          final_payload: args.final ?? args.proposed,
          raw_message: args.raw_message ?? null,
        },
      }).catch(() => { /* silent — never break the primary flow */ });
    },
    [logFn],
  );
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; if (muted) cancelSpeak(); }, [muted]);
  const ttsSupported = isSpeechSynthesisSupported();
  const maybeSpeak = useCallback((t: string) => {
    if (mutedRef.current) return;
    speak(t);
  }, []);


  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ask = useMutation({
    mutationFn: async (text: string): Promise<AssistantResult> => {
      const history = messages
        .slice(-8)
        .map((m) => {
          if ("text" in m) return { role: m.role, text: m.text };
          if ("draft" in m) return { role: "assistant" as const, text: m.draft.summary };
          if ("batch" in m) {
            return {
              role: "assistant" as const,
              text: `Batch of ${m.batch.drafts.length} trips: ${m.batch.drafts.map((d) => d.summary).join("; ")}`,
            };
          }
          if ("fix" in m) return { role: "assistant" as const, text: m.fix.summary };
          if ("suggest" in m) return { role: "assistant" as const, text: m.suggest.summary };
          if ("merge" in m) return { role: "assistant" as const, text: m.merge.summary };
          if ("actions" in m) return { role: "assistant" as const, text: m.actions.summary };
          return { role: "assistant" as const, text: "" };
        });
      return (await askFn({
        data: {
          message: text,
          history,
          screen: screen
            ? { path: screen.path ?? (typeof window !== "undefined" ? window.location.pathname : null), trip: screen.trip ?? null }
            : { path: typeof window !== "undefined" ? window.location.pathname : null, trip: null },
        },
      })) as AssistantResult;
    },
    onSuccess: (result) => {
      const id = crypto.randomUUID();
      const rawMessage = lastUserMsgRef.current;
      if (result.kind === "draft") {
        setMessages((m) => [...m, { id, role: "assistant", draft: result, rawMessage }]);
      } else if (result.kind === "batch") {
        setMessages((m) => [...m, { id, role: "assistant", batch: result, rawMessage }]);
      } else if (result.kind === "data_fix") {
        setMessages((m) => [...m, { id, role: "assistant", fix: result, rawMessage }]);
      } else if (result.kind === "partner_suggest") {
        setMessages((m) => [...m, { id, role: "assistant", suggest: result, rawMessage }]);
      } else if (result.kind === "merge_trips") {
        setMessages((m) => [...m, { id, role: "assistant", merge: result, rawMessage }]);
      } else if (result.kind === "command_actions") {
        setMessages((m) => [
          ...m,
          {
            id,
            role: "assistant",
            actions: result,
            rawMessage,
            selected: result.actions.map(() => true),
          },
        ]);
      } else if (result.kind === "auto_coordinate") {
        setMessages((m) => [...m, { id, role: "assistant", text: `${result.intro}\n(Open Calendar → AI Auto-Coordinate to review and accept the proposals.)` }]);
        maybeSpeak(result.intro);
      } else {
        setMessages((m) => [...m, { id, role: "assistant", text: result.text }]);
        maybeSpeak(result.text);
      }

    },

    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Assistant failed. Try again.";
      toast.error(msg);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", text: `⚠ ${msg}` }]);
    },
  });

  const sendText = useCallback((text: string) => {
    const t = text.trim();
    if (!t || ask.isPending) return;
    cancelSpeak();
    lastUserMsgRef.current = t;
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: t }]);
    setInput("");
    ask.mutate(t);
  }, [ask]);

  const send = () => sendText(input);

  const voice = useSpeechRecognition({
    onFinal: (t) => sendText(t),
    onError: (msg) => toast.error(msg),
  });


  const missingCreateFields = useCallback((f: AssistantDraft["fields"]): string[] => {
    const missing: string[] = [];
    if (!f.from_location) missing.push("from");
    if (!f.to_location) missing.push("to");
    if (!f.date) missing.push("date");
    if (!f.time) missing.push("time");
    return missing;
  }, []);

  const createDraft = useCallback(
    async (draft: AssistantDraft) => {
      const f = draft.fields;
      const missing = missingCreateFields(f);
      if (missing.length) throw new Error(`Missing ${missing.join(", ")} for "${draft.summary}".`);
      const pax = (f.pax ?? []).map((n) => n.trim()).filter(Boolean);
      return createFn({
        data: {
          from_location: f.from_location!,
          to_location: f.to_location!,
          date: f.date!,
          time: f.time!,
          flightorship: "",
          from_flight: f.from_flight ?? "",
          to_flight: f.to_flight ?? "",
          clientcompanyname: f.clientcompanyname ?? "",
          qr_strict_mode: false,
          tracking_enabled: false,
          vehicle: f.vehicle ?? "",
          contact_phone: f.contact_phone ?? "",
          driver_id: f.driver_id ?? null,
          label_ids: [],
          pickup_place_id: null,
          dropoff_place_id: null,
          pickup_display_name: null,
          dropoff_display_name: null,
          tracking_kind: "flight",
          pax,
        },
      });
    },
    [createFn, missingCreateFields],
  );

  const confirm = useMutation({
    mutationFn: async ({ draft }: { draft: AssistantDraft; rawMessage?: string }) => {
      if (draft.action === "update") {
        const id = draft.target_trip_id ?? screen?.trip?.id;
        if (!id) throw new Error("No trip selected to update.");
        const f = draft.fields;
        const existing = (await getJobFn({ data: { id } })) as Record<string, unknown>;
        const payload = {
          id,
          from_location: (f.from_location ?? existing.from_location) as string,
          to_location: (f.to_location ?? existing.to_location) as string,
          date: (f.date ?? existing.date) as string,
          time: (f.time ?? existing.time) as string,
          flightorship: (existing.flightorship ?? "") as string,
          from_flight: (f.from_flight ?? existing.from_flight ?? "") as string,
          to_flight: (f.to_flight ?? existing.to_flight ?? "") as string,
          clientcompanyname: (f.clientcompanyname ?? existing.clientcompanyname ?? "") as string,
          qr_strict_mode: (existing.qr_strict_mode ?? false) as boolean,
          tracking_enabled: (existing.tracking_enabled ?? false) as boolean,
          vehicle: (f.vehicle ?? existing.vehicle ?? "") as string,
          contact_phone: (f.contact_phone ?? existing.contact_phone ?? "") as string,
          driver_id: (f.driver_id ?? (existing.driver_id as string | null)) as string | null,
          pickup_place_id: (existing.pickup_place_id ?? null) as string | null,
          dropoff_place_id: (existing.dropoff_place_id ?? null) as string | null,
          pickup_display_name: (existing.pickup_display_name ?? null) as string | null,
          dropoff_display_name: (existing.dropoff_display_name ?? null) as string | null,
          tracking_kind: (existing.tracking_kind ?? "flight") as "flight" | "vessel",
          pax: f.pax ?? undefined,
        };
        const res = await updateFn({ data: payload });
        // Before-state = only the fields we're about to change.
        const beforeSnap: Record<string, unknown> = { id };
        const afterSnap: Record<string, unknown> = { id };
        for (const k of Object.keys(f)) {
          if (k in existing) beforeSnap[k] = (existing as Record<string, unknown>)[k];
          afterSnap[k] = (f as Record<string, unknown>)[k];
        }
        return { res, kind: "update" as const, id, beforeSnap, afterSnap };
      }
      const created = (await createDraft(draft)) as { id?: string; updated_at?: string } & Record<string, unknown>;
      return { res: created, kind: "create" as const, id: created?.id ?? null, createdRow: created };
    },
    onSuccess: (out, vars) => {
      const { draft, rawMessage } = vars;
      const msg = draft.action === "create" ? "Trip created." : "Trip updated.";
      toast.success(msg);
      maybeSpeak(msg);
      logLearning({ action_kind: "draft", outcome: "confirmed", proposed: draft, raw_message: rawMessage });
      if (out.kind === "create" && out.id) {
        logAudit({
          action_kind: "create",
          target_table: "jobs",
          target_id: out.id,
          before_state: null,
          after_state: out.createdRow,
          summary: draft.summary,
          raw_message: rawMessage ?? null,
        });
      } else if (out.kind === "update" && out.id) {
        logAudit({
          action_kind: "update",
          target_table: "jobs",
          target_id: out.id,
          before_state: out.beforeSnap,
          after_state: out.afterSnap,
          summary: draft.summary,
          raw_message: rawMessage ?? null,
        });
      }
      // Per-action pricing: single confirmed trip → 1× assistant_trip_action.
      void meterFn({
        data: {
          feature_key: "assistant_trip_action",
          count: 1,
          job_id: draft.action === "update" ? draft.target_trip_id ?? null : null,
          note: `assistant ${draft.action}: ${draft.summary}`.slice(0, 200),
        },
      }).catch(() => { /* soft */ });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      qc.invalidateQueries({ queryKey: ["my-billing"] });
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", text: `✔ Done — ${draft.summary}` },
      ]);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Could not apply the change.";
      toast.error(msg);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", text: `⚠ ${msg}` }]);
    },
  });

  const updateExisting = useCallback(
    async (draft: AssistantDraft) => {
      const id = draft.target_trip_id;
      if (!id) throw new Error("No trip id on update draft.");
      const f = draft.fields;
      const existing = (await getJobFn({ data: { id } })) as Record<string, unknown>;
      const payload = {
        id,
        from_location: (f.from_location ?? existing.from_location) as string,
        to_location: (f.to_location ?? existing.to_location) as string,
        date: (f.date ?? existing.date) as string,
        time: (f.time ?? existing.time) as string,
        flightorship: (existing.flightorship ?? "") as string,
        from_flight: (f.from_flight ?? existing.from_flight ?? "") as string,
        to_flight: (f.to_flight ?? existing.to_flight ?? "") as string,
        clientcompanyname: (f.clientcompanyname ?? existing.clientcompanyname ?? "") as string,
        qr_strict_mode: (existing.qr_strict_mode ?? false) as boolean,
        tracking_enabled: (existing.tracking_enabled ?? false) as boolean,
        vehicle: (f.vehicle ?? existing.vehicle ?? "") as string,
        contact_phone: (f.contact_phone ?? existing.contact_phone ?? "") as string,
        driver_id: (f.driver_id ?? (existing.driver_id as string | null)) as string | null,
        pickup_place_id: (existing.pickup_place_id ?? null) as string | null,
        dropoff_place_id: (existing.dropoff_place_id ?? null) as string | null,
        pickup_display_name: (existing.pickup_display_name ?? null) as string | null,
        dropoff_display_name: (existing.dropoff_display_name ?? null) as string | null,
        tracking_kind: (existing.tracking_kind ?? "flight") as "flight" | "vessel",
        pax: f.pax ?? undefined,
      };
      return updateFn({ data: payload });
    },
    [getJobFn, updateFn],
  );

  const confirmBatch = useMutation({
    mutationFn: async (batchMsgId: string) => {
      const msg = messages.find((x) => x.id === batchMsgId && "batch" in x) as
        | (ChatMsg & { batch: AssistantBatch; rawMessage?: string })
        | undefined;
      if (!msg) throw new Error("Batch no longer available.");
      const drafts = msg.batch.drafts;
      const ok: string[] = [];
      const failed: { summary: string; error: string }[] = [];
      for (const d of drafts) {
        try {
          if (d.action === "update") {
            const id = d.target_trip_id!;
            const before = (await getJobFn({ data: { id } })) as Record<string, unknown>;
            await updateExisting(d);
            const f = d.fields as Record<string, unknown>;
            const beforeSnap: Record<string, unknown> = { id };
            const afterSnap: Record<string, unknown> = { id };
            for (const k of Object.keys(f)) {
              if (k in before) beforeSnap[k] = before[k];
              afterSnap[k] = f[k];
            }
            logAudit({
              action_kind: "search_update",
              target_table: "jobs",
              target_id: id,
              before_state: beforeSnap,
              after_state: afterSnap,
              summary: d.summary,
              raw_message: msg.rawMessage ?? null,
            });
          } else {
            const created = (await createDraft(d)) as Record<string, unknown> & { id?: string };
            if (created?.id) {
              logAudit({
                action_kind: "create",
                target_table: "jobs",
                target_id: created.id,
                before_state: null,
                after_state: created,
                summary: d.summary,
                raw_message: msg.rawMessage ?? null,
              });
            }
          }
          ok.push(d.summary);
        } catch (e) {
          failed.push({ summary: d.summary, error: e instanceof Error ? e.message : "failed" });
        }
      }
      const isUpdateBatch = drafts.every((d) => d.action === "update");
      return { ok, failed, isUpdateBatch };
    },
    onSuccess: (res, batchMsgId) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      qc.invalidateQueries({ queryKey: ["my-billing"] });
      // Silent learning: log the batch outcome (edited_then_confirmed if the
      // coordinator removed items before Confirm all, else confirmed).
      const batchMsg = messages.find((x) => x.id === batchMsgId && "batch" in x) as
        | (ChatMsg & { batch: AssistantBatch; rawMessage?: string })
        | undefined;
      if (batchMsg) {
        const proposedKind = batchMsg.batch.drafts.some((d) => d.target_trip_id) ? "search_update" : "batch";
        logLearning({
          action_kind: proposedKind,
          outcome: "confirmed",
          proposed: batchMsg.batch,
          final: { drafts: batchMsg.batch.drafts, ok: res.ok, failed: res.failed },
          raw_message: batchMsg.rawMessage,
        });
      }
      // Per-action pricing: charge assistant_trip_action ONCE PER confirmed
      // trip in the batch (create OR update).
      if (res.ok.length > 0) {
        void meterFn({
          data: {
            feature_key: "assistant_trip_action",
            count: res.ok.length,
            note: `assistant batch ${res.isUpdateBatch ? "edit" : "create"}: ${res.ok.length} trips`,
          },
        }).catch(() => { /* soft */ });
      }
      const verb = res.isUpdateBatch ? "Updated" : "Created";
      if (res.ok.length && !res.failed.length) toast.success(`${verb} ${res.ok.length} trips.`);
      else if (res.ok.length && res.failed.length) toast.warning(`${verb} ${res.ok.length}, ${res.failed.length} failed.`);
      else toast.error(res.isUpdateBatch ? "No trips updated." : "No trips created.");
      const lines = [
        ...res.ok.map((s) => `✔ ${s}`),
        ...res.failed.map((f) => `⚠ ${f.summary} — ${f.error}`),
      ].join("\n");
      setMessages((m) => [
        ...m.filter((x) => x.id !== batchMsgId || res.failed.length > 0),
        { id: crypto.randomUUID(), role: "assistant", text: lines || "Nothing to do." },
      ]);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Batch failed.");
    },
  });

  const removeBatchItem = (batchId: string, idx: number) => {
    setMessages((m) =>
      m
        .map((x) => {
          if (x.id !== batchId || !("batch" in x)) return x;
          const skipped = x.batch.drafts[idx];
          if (skipped) {
            logLearning({ action_kind: "batch", outcome: "skipped", proposed: skipped, raw_message: x.rawMessage });
          }
          const drafts = x.batch.drafts.filter((_, i) => i !== idx);
          return { ...x, batch: { ...x.batch, drafts } };
        })
        .filter((x) => !("batch" in x) || x.batch.drafts.length > 0),
    );
  };

  const confirmFix = useMutation({
    mutationFn: async (fix: AssistantDataFix) => {
      if (fix.target === "trip") {
        // Reuse existing updateJob: pull the current row, patch the single field.
        const existing = (await getJobFn({ data: { id: fix.target_id } })) as Record<string, unknown>;
        const patched: Record<string, unknown> = { ...existing, [fix.field]: fix.new_value };
        const payload = {
          id: fix.target_id,
          from_location: (patched.from_location ?? "") as string,
          to_location: (patched.to_location ?? "") as string,
          date: patched.date as string,
          time: patched.time as string,
          flightorship: (patched.flightorship ?? "") as string,
          from_flight: (patched.from_flight ?? "") as string,
          to_flight: (patched.to_flight ?? "") as string,
          clientcompanyname: (patched.clientcompanyname ?? "") as string,
          qr_strict_mode: (patched.qr_strict_mode ?? false) as boolean,
          tracking_enabled: (patched.tracking_enabled ?? false) as boolean,
          vehicle: (patched.vehicle ?? "") as string,
          contact_phone: (patched.contact_phone ?? "") as string,
          driver_id: (patched.driver_id ?? null) as string | null,
          pickup_place_id: (patched.pickup_place_id ?? null) as string | null,
          dropoff_place_id: (patched.dropoff_place_id ?? null) as string | null,
          pickup_display_name: (patched.pickup_display_name ?? null) as string | null,
          dropoff_display_name: (patched.dropoff_display_name ?? null) as string | null,
          tracking_kind: (patched.tracking_kind ?? "flight") as "flight" | "vessel",
        };
        await updateFn({ data: payload });
        return { beforeVal: existing[fix.field] ?? null };
      }
      // driver
      const patch: { id: string; name?: string; phone?: string | null } = { id: fix.target_id };
      if (fix.field === "name") patch.name = fix.new_value;
      else if (fix.field === "phone") patch.phone = fix.new_value;
      else throw new Error(`Unsupported driver field: ${fix.field}`);
      await updateDriverFn({ data: patch });
      return { beforeVal: fix.old_value ?? null };
    },
    onSuccess: (out, fix) => {
      const msg = `Fixed ${fix.field_label.toLowerCase()}.`;
      toast.success(msg);
      maybeSpeak(msg);
      logLearning({ action_kind: "data_fix", outcome: "confirmed", proposed: fix });
      logAudit({
        action_kind: "data_fix",
        target_table: fix.target === "trip" ? "jobs" : "drivers",
        target_id: fix.target_id,
        before_state: { id: fix.target_id, [fix.field]: out.beforeVal },
        after_state: { id: fix.target_id, [fix.field]: fix.new_value },
        summary: fix.summary,
      });
      void meterFn({
        data: {
          feature_key: "assistant_data_fix",
          count: 1,
          job_id: fix.target === "trip" ? fix.target_id : null,
          note: `assistant data_fix: ${fix.summary}`.slice(0, 200),
        },
      }).catch(() => { /* soft */ });
      if (fix.target === "trip") {
        qc.invalidateQueries({ queryKey: ["jobs"] });
        qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      } else {
        qc.invalidateQueries({ queryKey: ["drivers"] });
      }
      qc.invalidateQueries({ queryKey: ["my-billing"] });
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", text: `✔ ${fix.summary}` },
      ]);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Could not apply the fix.";
      toast.error(msg);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", text: `⚠ ${msg}` }]);
    },
  });

  // Confirm ONE partner suggestion — reuses the existing Collaborate
  // dispatchJobToPartner function (same call the manual Collaborate UI makes).
  // The assistant never triggers this itself; the coordinator must click
  // Confirm on the specific suggestion card.
  const dispatchPartnerFn = useServerFn(dispatchJobToPartner);
  const confirmSuggest = useMutation({
    mutationFn: async (item: AssistantPartnerSuggest["items"][number]) => {
      // Snapshot executor state BEFORE dispatch so undo can restore it.
      let before: Record<string, unknown> | null = null;
      try {
        const j = (await getJobFn({ data: { id: item.job_id } })) as Record<string, unknown>;
        before = {
          id: item.job_id,
          executor_company_id: j.executor_company_id ?? null,
        };
      } catch { /* soft — audit will simply record null before */ }
      await dispatchPartnerFn({
        data: {
          job_id: item.job_id,
          partner_company_id: item.partner_company_id,
          note: "Suggested by AI assistant",
        },
      });
      return { item, before };
    },
    onSuccess: ({ item, before }) => {
      const msg = `Sent to ${item.partner_name}.`;
      toast.success(msg);
      maybeSpeak(msg);
      logLearning({ action_kind: "partner_suggest", outcome: "confirmed", proposed: item });
      logAudit({
        action_kind: "partner_suggest",
        target_table: "jobs",
        target_id: item.job_id,
        before_state: before,
        after_state: { id: item.job_id, executor_company_id: item.partner_company_id },
        summary: `Forwarded to ${item.partner_name}`,
      });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      qc.invalidateQueries({ queryKey: ["collab", "connections"] });
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", text: `✔ Forwarded ${item.job_label} to ${item.partner_name}. They can accept or decline in their inbox.` },
      ]);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Could not forward the trip.";
      toast.error(msg);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", text: `⚠ ${msg}` }]);
    },
  });

  const removeSuggestItem = (msgId: string, idx: number) => {
    setMessages((m) =>
      m
        .map((x) => {
          if (x.id !== msgId || !("suggest" in x)) return x;
          const skipped = x.suggest.items[idx];
          if (skipped) {
            logLearning({ action_kind: "partner_suggest", outcome: "skipped", proposed: skipped, raw_message: x.rawMessage });
          }
          const items = x.suggest.items.filter((_, i) => i !== idx);
          return { ...x, suggest: { ...x.suggest, items } };
        })
        .filter((x) => !("suggest" in x) || x.suggest.items.length > 0),
    );
  };

  const confirmMerge = useMutation({
    mutationFn: async (msgId: string) => {
      const msg = messages.find((x) => x.id === msgId && "merge" in x) as
        | (ChatMsg & { merge: AssistantMergeTrips; rawMessage?: string })
        | undefined;
      if (!msg) throw new Error("Merge proposal not found.");
      const result = await mergeFn({
        data: {
          keep_job_id: msg.merge.keep_job_id,
          drop_job_ids: msg.merge.drop_job_ids,
        },
      });
      return { msgId, merge: msg.merge, result };
    },
    onSuccess: ({ msgId, merge, result }) => {
      const r = result as { cancelled?: number; merged_pax?: number };
      const cancelled = r.cancelled ?? merge.drop_job_ids.length;
      const msg = `Merged ${cancelled} duplicate trip${cancelled === 1 ? "" : "s"}.`;
      toast.success(msg);
      maybeSpeak(msg);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["trip-flags"] });
      qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      setMessages((m) => [
        ...m.map((x) => (x.id === msgId && "merge" in x ? { ...x, applied: true } : x)),
        { id: crypto.randomUUID(), role: "assistant", text: `✔ ${merge.summary}${r.merged_pax ? ` · ${r.merged_pax} passengers copied` : ""}` },
      ]);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Could not merge the trips.";
      toast.error(msg);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", text: `⚠ ${msg}` }]);
    },
  });



  // ------------- Structured command actions (group / ungroup / message) -------------
  // Stage via stageAssistantActions, then apply via the EXISTING
  // applyAiCommandActions server function — same audit path & metering the
  // old Command Bar uses. Per-item results are surfaced back into the chat.
  const stageFn = useServerFn(stageAssistantActions);
  const applyCmdFn = useServerFn(applyAiCommandActions);
  const confirmActions = useMutation({
    mutationFn: async (msgId: string) => {
      const msg = messages.find(
        (x): x is Extract<ChatMsg, { actions: AssistantCommandActions }> =>
          x.id === msgId && "actions" in x,
      );
      if (!msg) throw new Error("Actions not found");
      const chosenLocalIdx: number[] = [];
      const chosenActions = msg.actions.actions.filter((_, i) => {
        if (msg.selected[i]) {
          chosenLocalIdx.push(i);
          return true;
        }
        return false;
      });
      if (chosenActions.length === 0) throw new Error("Nothing selected");
      const stagePayload = chosenActions.map((a) => {
        if (a.type === "group") {
          return { type: "group" as const, job_ids: a.job_ids ?? [], group_name: a.group_name ?? null };
        }
        if (a.type === "ungroup") {
          return { type: "ungroup" as const, job_id: a.job_id ?? "" };
        }
        return {
          type: "message" as const,
          job_id: a.job_id ?? "",
          thread: (a.thread ?? "driver") as "driver" | "client" | "group",
          body: a.body ?? "",
        };
      });
      const staged = await stageFn({
        data: {
          raw_message: msg.rawMessage ?? "",
          summary: msg.actions.summary,
          actions: stagePayload,
        },
      });
      const res = (await applyCmdFn({
        data: {
          command_log_id: (staged as { id: string }).id,
          // We staged only the chosen ones; apply all staged indices.
          action_indices: chosenActions.map((_, i) => i),
        },
      })) as { ok: boolean; affected: number; results: Array<{ index: number; ok: boolean; message: string }> };
      // Map staged-index results back to the LOCAL (proposal) indices.
      const mapped = res.results.map((r) => ({
        index: chosenLocalIdx[r.index] ?? r.index,
        ok: r.ok,
        message: r.message,
      }));
      return { msgId, results: mapped, affected: res.affected };
    },
    onSuccess: ({ msgId, results, affected }) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      qc.invalidateQueries({ queryKey: ["trip-messages"] });
      qc.invalidateQueries({ queryKey: ["my-billing"] });
      const target = messages.find(
        (x): x is Extract<ChatMsg, { actions: AssistantCommandActions }> =>
          x.id === msgId && "actions" in x,
      );
      const okLines: string[] = [];
      const failLines: string[] = [];
      for (const r of results) {
        const label = target?.actions.actions[r.index]?.label ?? `Action ${r.index + 1}`;
        if (r.ok) okLines.push(`✔ ${label}`);
        else failLines.push(`⚠ ${label} — ${r.message}`);
      }
      if (target) {
        logLearning({
          action_kind: "batch",
          outcome: "confirmed",
          proposed: target.actions,
          final: { results },
          raw_message: target.rawMessage,
        });
      }
      setMessages((m) =>
        m.map((x) => {
          if (x.id !== msgId || !("actions" in x)) return x;
          return { ...x, applied: true, results };
        }),
      );
      const summary =
        failLines.length === 0
          ? `Applied ${affected} action${affected === 1 ? "" : "s"}.`
          : `Applied ${affected} of ${results.length}. ${failLines.length} failed.`;
      const body = [...okLines, ...failLines].join("\n");
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", text: `${summary}\n${body}` },
      ]);
      if (failLines.length === 0) toast.success(summary);
      else if (okLines.length === 0) toast.error(summary);
      else toast.warning(summary);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Could not apply actions.";
      toast.error(msg);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", text: `⚠ ${msg}` }]);
    },
  });

  const toggleActionRow = (msgId: string, idx: number) => {
    setMessages((m) =>
      m.map((x) => {
        if (x.id !== msgId || !("actions" in x) || x.applied) return x;
        const selected = x.selected.map((v, i) => (i === idx ? !v : v));
        return { ...x, selected };
      }),
    );
  };


  const dismissDraft = (id: string) => {
    setMessages((m) => {
      const target = m.find((x) => x.id === id);
      if (target) {
        if ("draft" in target) {
          logLearning({ action_kind: "draft", outcome: "cancelled", proposed: target.draft, raw_message: target.rawMessage });
        } else if ("batch" in target) {
          logLearning({ action_kind: "batch", outcome: "cancelled", proposed: target.batch, raw_message: target.rawMessage });
        } else if ("fix" in target) {
          logLearning({ action_kind: "data_fix", outcome: "cancelled", proposed: target.fix, raw_message: target.rawMessage });
        } else if ("suggest" in target) {
          logLearning({ action_kind: "partner_suggest", outcome: "cancelled", proposed: target.suggest, raw_message: target.rawMessage });
        } else if ("actions" in target) {
          logLearning({ action_kind: "batch", outcome: "cancelled", proposed: target.actions, raw_message: target.rawMessage });
        }
      }
      return m.filter((x) => x.id !== id);
    });
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:bg-primary/90 sm:bottom-6 sm:right-6"
          aria-label="Open AI dispatch assistant"
        >
          <Sparkles className="h-5 w-5" />
        </button>
      )}
      {open && (
        <div
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-2xl sm:m-4 sm:h-[calc(100vh-2rem)] sm:rounded-lg sm:border"
          role="dialog"
          aria-label="AI dispatch assistant"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <div>
                <div className="text-sm font-semibold">AI dispatch assistant</div>
                <div className="text-xs text-muted-foreground">
                  {screen?.trip ? `On trip · ${screen.trip.from_location ?? "?"} → ${screen.trip.to_location ?? "?"}` : "Ask, or draft a trip."}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {ttsSupported && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setMuted((v) => !v)}
                  aria-label={muted ? "Unmute spoken replies" : "Mute spoken replies"}
                  title={muted ? "Unmute spoken replies" : "Mute spoken replies"}
                >
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
              )}
              <Button size="icon" variant="ghost" onClick={() => { cancelSpeak(); setOpen(false); }} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div ref={scrollRef} className="flex flex-col gap-3 p-4">
              {messages.length === 0 && (
                <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Try: <em>"Move this trip to 19:30"</em>, <em>"Create a trip tomorrow 10am from Hilton to airport"</em>, or <em>"How does auto-forward work?"</em>
                  <div className="mt-2">Always verify before saving — AI can be wrong.</div>
                </div>
              )}
              {messages.map((m) => {
                if ("draft" in m) {
                  const rows = draftFieldSummary(m.draft.fields);
                  const busy = confirm.isPending;
                  return (
                    <div key={m.id} className="flex gap-2">
                      <div className="mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary/10">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 rounded-md border bg-muted/30 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {m.draft.action === "create" ? "Draft new trip" : "Proposed change"}
                        </div>
                        <div className="mb-2 text-sm">{m.draft.summary}</div>
                        {rows.length > 0 && (
                          <dl className="mb-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                            {rows.map((r) => (
                              <div key={r.label} className="contents">
                                <dt className="text-muted-foreground">{r.label}</dt>
                                <dd className="font-medium">{r.value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {m.draft.warnings?.length ? (
                          <ul className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                            {m.draft.warnings.map((w, i) => (
                              <li key={i}>⚠ {paxWarningLabel(w)}</li>
                            ))}
                          </ul>
                        ) : null}
                        <div className="flex gap-2">
                          <Button size="sm" disabled={busy} onClick={() => confirm.mutate({ draft: m.draft, rawMessage: m.rawMessage })}>
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            Confirm
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismissDraft(m.id)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                }
                if ("batch" in m) {
                  const busy = confirmBatch.isPending;
                  const isUpdateBatch = m.batch.drafts.every((d) => d.action === "update");
                  const anyMissing = !isUpdateBatch && m.batch.drafts.some((d) => missingCreateFields(d.fields).length > 0);
                  const anyBlockingWarn = m.batch.drafts.some((d) => hasBlockingPaxWarning(d.warnings));
                  return (
                    <div key={m.id} className="flex gap-2">
                      <div className="mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary/10">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 rounded-md border bg-muted/30 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {isUpdateBatch ? `${m.batch.drafts.length} trip edits` : `${m.batch.drafts.length} new trips`}
                          </div>
                        </div>
                        {m.batch.clarify && (
                          <div className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                            {m.batch.clarify}
                          </div>
                        )}
                        <div className="mb-3 space-y-2">
                          {m.batch.drafts.map((d, i) => {
                            const rows = draftFieldSummary(d.fields);
                            const missing = d.action === "update" ? [] : missingCreateFields(d.fields);
                            return (
                              <div key={i} className="rounded border bg-background p-2">
                                <div className="mb-1 flex items-start justify-between gap-2">
                                  <div className="text-sm font-medium">
                                    {i + 1}. {d.summary}
                                  </div>
                                  <button
                                    type="button"
                                    className="text-xs text-muted-foreground hover:text-destructive"
                                    onClick={() => removeBatchItem(m.id, i)}
                                    disabled={busy}
                                    aria-label={`Remove trip ${i + 1}`}
                                  >
                                    Remove
                                  </button>
                                </div>
                                {rows.length > 0 && (
                                  <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
                                    {rows.map((r) => (
                                      <div key={r.label} className="contents">
                                        <dt className="text-muted-foreground">{r.label}</dt>
                                        <dd className="font-medium">{r.value}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                )}
                                {missing.length > 0 && (
                                  <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                                    Needs: {missing.join(", ")}
                                  </div>
                                )}
                                {d.warnings?.length ? (
                                  <ul className="mt-1 space-y-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                                    {d.warnings.map((w, j) => (
                                      <li key={j}>⚠ {paxWarningLabel(w)}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            disabled={busy || anyMissing || anyBlockingWarn}
                            onClick={() => confirmBatch.mutate(m.id)}
                          >
                            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                            Confirm all
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismissDraft(m.id)}>
                            Cancel
                          </Button>
                          {anyMissing && (
                            <span className="text-[11px] text-muted-foreground">
                              Reply with the missing info and I'll update the list.
                            </span>
                          )}
                          {anyBlockingWarn && !anyMissing && (
                            <span className="text-[11px] text-amber-700 dark:text-amber-300">
                              Resolve passenger warnings above before confirming all — or Remove the affected trip and re-send.
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );

                }
                if ("fix" in m) {
                  const busy = confirmFix.isPending;
                  const fix = m.fix;
                  return (
                    <div key={m.id} className="flex gap-2">
                      <div className="mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary/10">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 rounded-md border bg-muted/30 p-3">
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Proposed fix
                        </div>
                        <div className="mb-2 text-sm">{fix.summary}</div>
                        <div className="mb-3 space-y-1 rounded border bg-background p-2 text-xs">
                          <div className="text-[11px] text-muted-foreground">{fix.target_label}</div>
                          <div className="text-[11px] text-muted-foreground">{fix.field_label}</div>
                          <div className="flex items-center gap-2 pt-1">
                            <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-red-800 line-through dark:text-red-300">
                              {fix.old_value ?? "(empty)"}
                            </span>
                            <span className="text-muted-foreground">→</span>
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-800 dark:text-emerald-300">
                              {fix.new_value}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" disabled={busy} onClick={() => confirmFix.mutate(fix)}>
                            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                            Confirm
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismissDraft(m.id)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                }
                if ("suggest" in m) {
                  const busyItem = confirmSuggest.isPending ? confirmSuggest.variables?.job_id : null;
                  return (
                    <div key={m.id} className="flex gap-2">
                      <div className="mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary/10">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 rounded-md border bg-muted/30 p-3">
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Suggested hand-off
                        </div>
                        <div className="mb-2 text-sm">{m.suggest.summary}</div>
                        <div className="mb-2 rounded border border-dashed p-2 text-[11px] text-muted-foreground">
                          I only share what Collaborate already shares with your partner (the trip details you send). Nothing else about your company is exposed. Each item needs your Confirm.
                        </div>
                        <div className="mb-2 space-y-2">
                          {m.suggest.items.map((it, i) => {
                            const busy = busyItem === it.job_id;
                            return (
                              <div key={i} className="rounded border bg-background p-2">
                                <div className="mb-1 flex items-start justify-between gap-2">
                                  <div className="text-sm">
                                    <div className="font-medium">{it.job_label}</div>
                                    <div className="text-xs text-muted-foreground">
                                      → Forward to <span className="font-medium text-foreground">{it.partner_name}</span>
                                    </div>
                                    {it.reason && (
                                      <div className="mt-0.5 text-[11px] text-muted-foreground italic">{it.reason}</div>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    className="text-xs text-muted-foreground hover:text-destructive"
                                    onClick={() => removeSuggestItem(m.id, i)}
                                    disabled={busy}
                                    aria-label={`Skip trip ${i + 1}`}
                                  >
                                    Skip
                                  </button>
                                </div>
                                <div className="mt-2 flex gap-2">
                                  <Button size="sm" disabled={busy} onClick={() => confirmSuggest.mutate(it)}>
                                    {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                                    Send to {it.partner_name}
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => dismissDraft(m.id)}>
                            Dismiss all
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                }
                if ("actions" in m) {
                  const busy = confirmActions.isPending && confirmActions.variables === m.id;
                  const chosenCount = m.selected.filter(Boolean).length;
                  const resultByIdx = new Map((m.results ?? []).map((r) => [r.index, r]));
                  return (
                    <div key={m.id} className="flex gap-2">
                      <div className="mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary/10">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 rounded-md border bg-muted/30 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {m.applied ? "Actions applied" : "Proposed actions — needs your approval"}
                        </div>
                        {m.actions.summary && (
                          <div className="mb-2 text-sm">{m.actions.summary}</div>
                        )}
                        <div className="mb-3 space-y-1.5 rounded border bg-background p-2">
                          {m.actions.actions.map((a, i) => {
                            const r = resultByIdx.get(i);
                            return (
                              <label key={i} className="flex items-start gap-2 text-xs">
                                {!m.applied && (
                                  <input
                                    type="checkbox"
                                    checked={m.selected[i]}
                                    onChange={() => toggleActionRow(m.id, i)}
                                    disabled={busy}
                                    className="mt-0.5"
                                  />
                                )}
                                <span className={`flex-1 ${r && !r.ok ? "text-destructive" : ""}`}>{a.label}</span>
                                {r && (
                                  <span className={r.ok ? "text-emerald-600" : "text-destructive"}>
                                    {r.ok ? "✓" : "✗"} {r.message}
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                        {!m.applied && (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              disabled={busy || chosenCount === 0}
                              onClick={() => confirmActions.mutate(m.id)}
                            >
                              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                              Confirm selected ({chosenCount})
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismissDraft(m.id)}>
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                if ("merge" in m) {
                  const busy = confirmMerge.isPending && confirmMerge.variables === m.id;
                  return (
                    <div key={m.id} className="flex gap-2">
                      <div className="mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary/10">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 rounded-md border bg-muted/30 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {m.applied ? "Merge applied" : "Merge duplicate trips — needs your approval"}
                        </div>
                        <div className="mb-2 text-sm">{m.merge.summary}</div>
                        <div className="mb-3 rounded border bg-background p-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Keep </span>
                            <span className="font-mono">{m.merge.keep_job_id.slice(0, 8)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Cancel as duplicate </span>
                            <span className="font-mono">{m.merge.drop_job_ids.map((id) => id.slice(0, 8)).join(", ")}</span>
                          </div>
                        </div>
                        {!m.applied && (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" disabled={busy} onClick={() => confirmMerge.mutate(m.id)}>
                              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                              Confirm merge
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismissDraft(m.id)}>
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                const isUser = m.role === "user";
                return (
                  <div key={m.id} className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
                    <div className={`mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-full ${isUser ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
                      {isUser ? <UserIcon className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                    </div>
                    <div className={`max-w-[85%] whitespace-pre-wrap rounded-md px-3 py-2 text-sm ${isUser ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {m.text}
                    </div>
                  </div>
                );
              })}
              {ask.isPending && (
                <div className="flex gap-2">
                  <div className="mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary/10">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Thinking…</div>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="border-t p-3">
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={voice.listening ? "Listening…" : "Ask about this trip, or say what to change…"}
                rows={2}
                className="min-h-[44px] resize-none"
                disabled={ask.isPending}
              />
              {voice.supported && (
                <Button
                  size="icon"
                  variant={voice.listening ? "destructive" : "outline"}
                  onClick={voice.toggle}
                  disabled={ask.isPending}
                  aria-label={voice.listening ? "Stop voice input" : "Start voice input"}
                  title={voice.listening ? "Stop voice input" : "Start voice input"}
                >
                  {voice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
              )}
              <Button size="icon" onClick={send} disabled={ask.isPending || !input.trim()} aria-label="Send">
                {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Verify before confirming. Each turn costs 1 point.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
