"use client";
import { useState } from "react";
import { Sparkles, Loader2, ShieldAlert } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { submitLesson } from "@/lib/ai-lessons.functions";
import { redactPii } from "@/lib/ai-pii.client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { SafetyBanner } from "./SafetyBanner";

type Kind = "parse_pattern" | "qa" | "suggestion_rule" | "signal_fix";

export function TeachAiDialog({
  trigger,
  defaultKind = "parse_pattern",
  defaultExample = "",
}: {
  trigger?: React.ReactNode;
  defaultKind?: Kind;
  defaultExample?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [title, setTitle] = useState("");
  const [example, setExample] = useState(defaultExample);
  const [rule, setRule] = useState("");
  const [proposeGlobal, setProposeGlobal] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = useServerFn(submitLesson);

  // Preview redacted example
  const preview = example ? redactPii(example) : null;

  const submit = async () => {
    if (title.trim().length < 3 || example.trim().length < 1 || rule.trim().length < 3) {
      toast.error("Fill in title, example, and rule.");
      return;
    }
    setBusy(true);
    try {
      const r = await send({ data: { kind, title, example_input: example, rule_text: rule, propose_global: proposeGlobal } });
      toast.success(
        r.propose_global ? "Submitted for admin review." : "Lesson saved for your company.",
      );
      setOpen(false);
      setTitle(""); setExample(""); setRule(""); setProposeGlobal(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Teach the AI
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Teach the AI</DialogTitle>
        </DialogHeader>

        <SafetyBanner />

        <div className="space-y-3">
          <div>
            <Label className="text-xs">What kind of lesson?</Label>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as Kind)} className="mt-1 grid grid-cols-2 gap-1.5">
              {[
                ["parse_pattern", "Message format"],
                ["qa", "How-to answer"],
                ["suggestion_rule", "Suggestion rule"],
                ["signal_fix", "Signal → fix"],
              ].map(([v, l]) => (
                <div key={v} className="flex items-center gap-2 rounded-md border p-2 text-xs">
                  <RadioGroupItem value={v} id={v} /> <Label htmlFor={v} className="cursor-pointer">{l}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div>
            <Label htmlFor="lesson-title" className="text-xs">Short title</Label>
            <Input id="lesson-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder='e.g. "Hilton emails put pax count in brackets"' />
          </div>

          <div>
            <Label htmlFor="lesson-example" className="text-xs">Example input</Label>
            <Textarea
              id="lesson-example"
              rows={4}
              value={example}
              onChange={(e) => setExample(e.target.value)}
              placeholder="Paste a message or extract exactly as it comes in…"
            />
            {preview && Object.keys(preview.stripped).length > 0 && (
              <div className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                <ShieldAlert className="mt-0.5 h-3 w-3" />
                <span>
                  Personal data will be replaced with tags before storage:{" "}
                  {Object.entries(preview.stripped).map(([k, n]) => `${k}(${n})`).join(", ")}.
                </span>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="lesson-rule" className="text-xs">The rule to remember</Label>
            <Textarea
              id="lesson-rule"
              rows={3}
              value={rule}
              onChange={(e) => setRule(e.target.value)}
              placeholder='e.g. "Number in brackets after the name is the passenger count"'
            />
          </div>

          <label className="flex items-start gap-2 rounded-md border p-2 text-xs cursor-pointer">
            <Checkbox checked={proposeGlobal} onCheckedChange={(v) => setProposeGlobal(!!v)} />
            <span>
              <span className="font-medium">Propose to global brain</span> — an admin reviews before other companies benefit.
              Nothing is shared until approved.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy} onClick={submit}>
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Save lesson
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
