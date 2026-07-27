import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { crewT, type CrewLang } from "@/lib/crew-i18n";
import { readCrewSession, storeCrewSession } from "@/lib/crew-session";

export const Route = createFileRoute("/crew-portal")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Crew check-in" },
    { name: "robots", content: "noindex" },
  ] }),
  component: CrewPortalLoginPage,
});

function CrewPortalLoginPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [noToken, setNoToken] = useState(false);
  const [lang, setLang] = useState<CrewLang>("en");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (!t) { setNoToken(true); return; }
    setToken(t);
    const existing = readCrewSession();
    if (existing) navigate({ to: "/crew-portal/dashboard" });
  }, [navigate]);

  const t = (key: string, vars?: Record<string, string>) => crewT(lang, key, vars);

  async function sendCode() {
    if (!token || !email.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/crew-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email: email.trim() }),
      });
      if (!r.ok) { toast.error("Something went wrong. Please try again."); return; }
      setStep("code");
      toast.success("Code sent — check your email");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!token || code.trim().length !== 6) return;
    setBusy(true);
    try {
      const r = await fetch("/api/crew-portal/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email: email.trim(), code: code.trim(), preferred_language: lang }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(t("wrong_code")); return; }
      storeCrewSession({ jwt: j.jwt, expiresAt: Date.now() + j.expires_in * 1000, linkToken: token });
      navigate({ to: "/crew-portal/dashboard" });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setCode("");
    await sendCode();
  }

  if (noToken) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center bg-muted/30">
        <p className="text-sm text-muted-foreground max-w-xs">{crewT(lang, "link_invalid")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center p-4 bg-muted/30">
      <div className="w-full max-w-sm space-y-4">
        <LangSwitch lang={lang} onChange={setLang} />
        <Card>
          <CardContent className="p-6 space-y-4">
            <div>
              <h1 className="text-xl font-semibold">{t("login_title")}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {step === "email" ? t("login_subtitle") : t("code_subtitle", { email: email.trim() })}
              </p>
            </div>

            {step === "email" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="crew-email">{t("email_label")}</Label>
                  <Input
                    id="crew-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 text-base"
                  />
                </div>
                <Button className="w-full h-12 text-base" disabled={busy || !email.trim()} onClick={sendCode}>
                  {t("send_code")}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="crew-code">{t("code_label")}</Label>
                  <Input
                    id="crew-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="h-12 text-base tracking-[0.3em] text-center"
                  />
                </div>
                <Button className="w-full h-12 text-base" disabled={busy || code.length !== 6} onClick={verify}>
                  {t("verify")}
                </Button>
                <button
                  type="button"
                  className="w-full text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={resend}
                  disabled={busy}
                >
                  {t("resend_code")}
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LangSwitch({ lang, onChange }: { lang: CrewLang; onChange: (l: CrewLang) => void }) {
  return (
    <div className="flex justify-center gap-2">
      {(["en", "fil"] as CrewLang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            lang === l ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border"
          }`}
        >
          {crewT(l, "lang_name")}
        </button>
      ))}
    </div>
  );
}
