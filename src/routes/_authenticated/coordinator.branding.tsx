import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getMyCompany, updateMyBranding } from "@/lib/coordinator.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BrandingBar } from "@/components/branding/BrandingBar";
import { useFeatures } from "@/hooks/use-features";
import { Upload, Trash2, ImageIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/coordinator/branding")({
  head: () => ({ meta: [{ title: "Branding — Coordinator" }] }),
  component: BrandingPage,
});

const LOGO_MAX = 400_000;   // 400 KB
const ADVERT_MAX = 900_000; // 900 KB

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function BrandingPage() {
  const qc = useQueryClient();
  const getCompany = useServerFn(getMyCompany);
  const update = useServerFn(updateMyBranding);
  const { data: features } = useFeatures();
  const adminAllows = features?.branding_advert !== false;

  const { data: company } = useQuery({
    queryKey: ["my-company-branding"],
    queryFn: () => getCompany(),
  });

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [advertUrl, setAdvertUrl] = useState<string | null>(null);
  const [advertLink, setAdvertLink] = useState("");
  const [advertCaption, setAdvertCaption] = useState("");
  const [advertEnabled, setAdvertEnabled] = useState(false);
  useEffect(() => {
    if (!company) return;
    setLogoUrl((company as any).logo_url ?? null);
    setAdvertUrl((company as any).advert_url ?? null);
    setAdvertLink((company as any).advert_link ?? "");
    setAdvertCaption((company as any).advert_caption ?? "");
    setAdvertEnabled(!!(company as any).advert_enabled);
  }, [company]);

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof update>[0]["data"]) => update({ data: patch }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["my-company-branding"] });
      qc.invalidateQueries({ queryKey: ["my-company"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const logoRef = useRef<HTMLInputElement>(null);
  const advertRef = useRef<HTMLInputElement>(null);

  async function handleLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > LOGO_MAX) return toast.error("Logo must be under 400 KB");
    if (!file.type.startsWith("image/")) return toast.error("Please choose an image file");
    const url = await readAsDataUrl(file);
    setLogoUrl(url);
    save.mutate({ logo_url: url });
  }
  async function handleAdvert(file: File | undefined) {
    if (!file) return;
    if (file.size > ADVERT_MAX) return toast.error("Advert must be under 900 KB");
    if (!file.type.startsWith("image/")) return toast.error("Please choose an image file");
    const url = await readAsDataUrl(file);
    setAdvertUrl(url);
    save.mutate({ advert_url: url });
  }

  const previewBranding = {
    company_name: (company as any)?.name ?? "",
    logo_url: logoUrl,
    advert_url: adminAllows && advertEnabled ? advertUrl : null,
    advert_link: advertLink || null,
    advert_caption: advertCaption || null,
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-40">
      <div>
        <h1 className="text-2xl font-semibold">Branding</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Add your logo and an optional advert. Both appear at the bottom of the driver and client apps.
        </p>
      </div>

      {!adminAllows && (
        <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-sm p-3">
          Advert display is currently disabled by the administrator. Your logo still shows,
          but the advert banner will not be visible to drivers or clients until it's re-enabled.
        </div>
      )}

      {/* ---------------- LOGO ---------------- */}
      <section className="mt-6 rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold">Company logo</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Square works best. Max 400 KB. PNG with transparency recommended.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={logoRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => handleLogo(e.target.files?.[0])} />
            <Button variant="outline" size="sm" onClick={() => logoRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1.5" /> Upload
            </Button>
            {logoUrl && (
              <Button variant="ghost" size="sm"
                onClick={() => { setLogoUrl(null); save.mutate({ logo_url: null }); }}>
                <Trash2 className="h-4 w-4 mr-1.5" /> Remove
              </Button>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <div className="h-24 w-24 rounded-lg border bg-muted grid place-items-center overflow-hidden">
            {logoUrl
              ? <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
              : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
          </div>
          <div className="text-xs text-muted-foreground">
            {logoUrl ? "This logo will appear next to your name in driver and client screens." : "No logo yet."}
          </div>
        </div>
      </section>

      {/* ---------------- ADVERT ---------------- */}
      <section className="mt-6 rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold">Advert banner</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Shown at the bottom of driver and client screens. Wide format works best. Max 900 KB.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="advert-on" className="text-sm">Show</Label>
            <Switch
              id="advert-on"
              checked={advertEnabled}
              onCheckedChange={(v) => { setAdvertEnabled(v); save.mutate({ advert_enabled: v }); }}
              disabled={!advertUrl}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[auto,1fr] items-start">
          <div className="flex flex-col items-start gap-2">
            <div className="h-24 w-64 rounded-lg border bg-muted grid place-items-center overflow-hidden">
              {advertUrl
                ? <img src={advertUrl} alt="Advert" className="h-full w-full object-contain" />
                : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
            </div>
            <div className="flex gap-2">
              <input ref={advertRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => handleAdvert(e.target.files?.[0])} />
              <Button variant="outline" size="sm" onClick={() => advertRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1.5" /> Upload
              </Button>
              {advertUrl && (
                <Button variant="ghost" size="sm"
                  onClick={() => {
                    setAdvertUrl(null); setAdvertEnabled(false);
                    save.mutate({ advert_url: null, advert_enabled: false });
                  }}>
                  <Trash2 className="h-4 w-4 mr-1.5" /> Remove
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label htmlFor="advert-caption" className="text-xs">Caption (optional)</Label>
              <Input id="advert-caption" value={advertCaption} maxLength={200}
                onChange={(e) => setAdvertCaption(e.target.value)}
                onBlur={() => save.mutate({ advert_caption: advertCaption })}
                placeholder="e.g. Book your next transfer 20% off" />
            </div>
            <div>
              <Label htmlFor="advert-link" className="text-xs">Link (optional)</Label>
              <Input id="advert-link" value={advertLink} maxLength={500} inputMode="url"
                onChange={(e) => setAdvertLink(e.target.value)}
                onBlur={() => save.mutate({ advert_link: advertLink })}
                placeholder="https://your-site.com/offer" />
              <p className="text-[11px] text-muted-foreground mt-1">
                Opens in a new tab when a viewer taps the advert.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- LIVE PREVIEW ---------------- */}
      <section className="mt-6 rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Preview</h2>
        <p className="text-xs text-muted-foreground mt-1">
          This is exactly what drivers and clients see at the bottom of their screens.
        </p>
        <div className="relative mt-4 rounded-lg border bg-muted/40 h-40">
          <div className="absolute inset-x-0 bottom-0">
            {/* Local, non-fixed clone of BrandingBar for visual preview */}
            <PreviewBar branding={previewBranding} />
          </div>
        </div>
      </section>

      {/* Actual live footer at the very bottom of the page too */}
      <BrandingBar branding={previewBranding} />
    </div>
  );
}

function PreviewBar({ branding }: { branding: ReturnType<typeof Object> }) {
  const b = branding as any;
  if (!b.logo_url && !b.advert_url) {
    return <div className="p-4 text-xs text-center text-muted-foreground">Nothing to show yet.</div>;
  }
  return (
    <div className="mx-auto max-w-3xl px-2 pb-2">
      <div className="rounded-t-xl border border-b-0 bg-background shadow-lg flex items-center gap-3 pl-3 pr-3 py-2">
        {b.logo_url
          ? <img src={b.logo_url} alt="" className="h-9 w-9 rounded-md object-contain shrink-0" />
          : <div className="h-9 w-9 rounded-md bg-primary/10 grid place-items-center text-xs font-semibold">
              {(b.company_name ?? "").slice(0, 2).toUpperCase()}
            </div>}
        {b.advert_url ? (
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <img src={b.advert_url} alt="" className="h-14 w-auto max-w-[55%] object-contain rounded-md" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Sponsored</div>
              <div className="text-xs truncate">{b.advert_caption ?? b.company_name}</div>
            </div>
          </div>
        ) : (
          <div className="text-xs font-medium">{b.company_name}</div>
        )}
      </div>
    </div>
  );
}
