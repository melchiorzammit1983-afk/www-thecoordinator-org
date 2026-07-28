import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LogOut, Car } from "lucide-react";
import { crewT, type CrewLang } from "@/lib/crew-i18n";
import { readCrewSession, storeCrewSession, clearCrewSession, peekCrewLinkToken } from "@/lib/crew-session";
import { CREW_STATUS_ACTIONS } from "@/lib/crew-status";

export const Route = createFileRoute("/crew-portal/dashboard")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Crew dashboard" },
    { name: "robots", content: "noindex" },
  ] }),
  component: CrewDashboardPage,
});

type Leg = {
  id: string;
  leg_number: number;
  departure_date: string | null;
  arrival_date: string | null;
  from_location: string;
  to_location: string;
  flight_number: string | null;
};

type Boot = {
  crew: { id: string; name: string; surname: string; preferred_language: CrewLang };
  legs: Leg[];
  latest_status_by_leg: Record<string, { status: string; leg_number: number | null; created_at: string }>;
  driver: { first_name: string; vehicle: string | null; plate: string | null } | null;
};

function currentLegNumber(legs: Leg[], latestByLeg: Boot["latest_status_by_leg"]): number {
  for (const leg of legs) {
    const s = latestByLeg[String(leg.leg_number)]?.status;
    if (!s || !["landed", "arrived"].includes(s)) return leg.leg_number;
  }
  return legs[legs.length - 1]?.leg_number ?? 1;
}

function CrewDashboardPage() {
  const navigate = useNavigate();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lang, setLang] = useState<CrewLang>("en");
  const [selectedLeg, setSelectedLeg] = useState<number | null>(null);
  const [posting, setPosting] = useState(false);

  function bounceToLogin() {
    const token = peekCrewLinkToken();
    clearCrewSession();
    navigate({ to: "/crew-portal", search: token ? { token } : {} } as any);
  }

  async function load() {
    const session = readCrewSession();
    if (!session) {
      bounceToLogin();
      return;
    }
    try {
      const r = await fetch("/api/crew-portal/dashboard", {
        headers: { Authorization: `Bearer ${session.jwt}` },
      });
      if (!r.ok) {
        if (r.status === 401) {
          bounceToLogin();
          return;
        }
        setErr("dashboard_load_failed");
        return;
      }
      const j = await r.json();
      storeCrewSession({ jwt: j.session_token, expiresAt: Date.now() + j.expires_in * 1000, linkToken: session.linkToken });
      setBoot(j);
      setLang((j.crew?.preferred_language as CrewLang) ?? "en");
      setSelectedLeg((prev) => prev ?? currentLegNumber(j.legs ?? [], j.latest_status_by_leg ?? {}));
      setErr(null);
    } catch {
      setErr("dashboard_load_failed");
    }
  }

  useEffect(() => { load(); }, []);

  const t = (key: string, vars?: Record<string, string>) => crewT(lang, key, vars);

  async function postStatus(status: string) {
    const session = readCrewSession();
    if (!session) { bounceToLogin(); return; }
    setPosting(true);
    try {
      const r = await fetch("/api/crew-portal/status", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.jwt}` },
        body: JSON.stringify({ leg_number: selectedLeg, status }),
      });
      if (!r.ok) {
        if (r.status === 401) { bounceToLogin(); return; }
        toast.error("Could not update status"); return;
      }
      const j = await r.json();
      storeCrewSession({ jwt: j.session_token, expiresAt: Date.now() + j.expires_in * 1000, linkToken: session.linkToken });
      toast.success(t("status_updated"));
      await load();
    } finally {
      setPosting(false);
    }
  }

  function signOut() {
    bounceToLogin();
  }

  if (err) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center bg-muted/30">
        <p className="text-sm text-muted-foreground">Could not load your dashboard. Please try again.</p>
      </div>
    );
  }
  if (!boot) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  const legs = boot.legs ?? [];

  return (
    <div className="min-h-screen bg-muted/20 pb-10">
      <header className="bg-background border-b p-4 flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">{t("welcome", { name: boot.crew.name })}</div>
        </div>
        <div className="flex items-center gap-2">
          <LangSwitch lang={lang} onChange={setLang} />
          <Button variant="ghost" size="icon" onClick={signOut} title={t("sign_out")}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="font-medium">{t("your_itinerary")}</div>
            {legs.length === 0 && <p className="text-sm text-muted-foreground">{t("no_itinerary")}</p>}
            {legs.map((leg) => {
              const status = boot.latest_status_by_leg[String(leg.leg_number)]?.status;
              return (
                <button
                  key={leg.id}
                  type="button"
                  onClick={() => setSelectedLeg(leg.leg_number)}
                  className={`w-full text-left border rounded-lg p-3 transition-colors ${
                    selectedLeg === leg.leg_number ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(`leg_${leg.leg_number}`)}
                    </span>
                    {status && <Badge variant="secondary" className="text-[10px]">{t(status)}</Badge>}
                  </div>
                  <div className="mt-1 font-medium">{leg.from_location} → {leg.to_location}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {leg.flight_number ? `${leg.flight_number} · ` : ""}
                    {leg.departure_date ?? "—"}
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Car className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-sm">{t("pickup_driver")}</span>
            </div>
            {boot.driver ? (
              <div className="text-sm">
                {boot.driver.first_name}
                {boot.driver.vehicle && <> · {boot.driver.vehicle}{boot.driver.plate ? ` · ${boot.driver.plate}` : ""}</>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("pickup_driver_pending")}</p>
            )}
          </CardContent>
        </Card>

        {legs.length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="font-medium">
                {t("update_status")}
                {selectedLeg && legs.length > 1 && <span className="text-muted-foreground font-normal"> — {t(`leg_${selectedLeg}`)}</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {CREW_STATUS_ACTIONS.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    className="h-14 text-sm whitespace-normal"
                    disabled={posting}
                    onClick={() => postStatus(s)}
                  >
                    {t(s)}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function LangSwitch({ lang, onChange }: { lang: CrewLang; onChange: (l: CrewLang) => void }) {
  return (
    <div className="flex gap-1">
      {(["en", "fil"] as CrewLang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
            lang === l ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
