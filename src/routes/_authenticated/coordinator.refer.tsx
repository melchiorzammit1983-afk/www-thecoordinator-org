import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Copy, Check, Share2, Users, Gift } from "lucide-react";
import { toast } from "sonner";

import { listMyReferrals } from "@/lib/coordinator.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/coordinator/refer")({
  head: () => ({ meta: [{ title: "Refer & earn — The Coordinator" }] }),
  component: ReferPage,
});

const STATUS_STYLE: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  contacted: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  rejected: "bg-rose-500/15 text-rose-700 border-rose-500/30",
};

function ReferPage() {
  const fn = useServerFn(listMyReferrals);
  const { data, isLoading } = useQuery({
    queryKey: ["my-referrals"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = useMemo(
    () => (data?.code ? `${origin}/request-access?ref=${data.code}` : ""),
    [data?.code, origin],
  );

  const approvedCount = (data?.requests ?? []).filter((r) => r.status === "approved").length;
  const totalCount = data?.requests?.length ?? 0;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Referral link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed — select the link manually");
    }
  };

  const share = async () => {
    if (!link) return;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({
          title: "The Coordinator",
          text: "Join The Coordinator — pay-as-you-go transport dispatch. Use my link to request access:",
          url: link,
        });
      } catch {
        // user cancelled
      }
    } else {
      copy();
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Gift className="h-5 w-5 text-primary" /> Refer & earn
        </h1>
        <p className="text-sm text-muted-foreground">
          Share your personal link. When someone signs up through it, we'll credit the referral to your account.
        </p>
      </header>

      <section className="rounded-xl border bg-card p-4 space-y-3">
        <div className="text-xs font-medium uppercase text-muted-foreground">Your referral link</div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !data?.code ? (
          <div className="text-sm text-muted-foreground">Your account doesn't have a referral code yet.</div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input readOnly value={link} className="font-mono text-xs sm:text-sm" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" onClick={copy} className="shrink-0">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1.5 hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
              </Button>
              <Button type="button" onClick={share} className="shrink-0">
                <Share2 className="h-4 w-4" />
                <span className="ml-1.5 hidden sm:inline">Share</span>
              </Button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Code: <span className="font-mono">{data.code}</span> · Send this link over WhatsApp, email, or social — anyone who opens it will show up here.
            </div>
          </>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Total invites
          </div>
          <div className="mt-1 text-2xl font-semibold">{totalCount}</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5" /> Approved
          </div>
          <div className="mt-1 text-2xl font-semibold text-emerald-600">{approvedCount}</div>
        </div>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="px-4 py-3 border-b text-sm font-medium">People who used your link</div>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (data?.requests ?? []).length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No referrals yet. Share your link above to get started.
          </div>
        ) : (
          <ul className="divide-y">
            {data!.requests.map((r) => (
              <li key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {r.full_name}
                    {r.company_name ? <span className="text-muted-foreground"> · {r.company_name}</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {r.kind === "demo" && (
                    <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                      demo
                    </Badge>
                  )}
                  <Badge variant="outline" className={`${STATUS_STYLE[r.status] ?? ""} text-[10px]`}>
                    {r.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
