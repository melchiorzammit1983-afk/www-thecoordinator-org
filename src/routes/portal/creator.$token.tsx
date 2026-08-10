import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolvePortalRecipient } from "@/lib/portal-definitions.functions";

export const Route = createFileRoute("/portal/creator/$token")({
  head: () => ({ meta: [{ title: "Portal" }] }),
  component: CreatorPortalPage,
});

function CreatorPortalPage() {
  const { token } = Route.useParams();
  const resolveFn = useServerFn(resolvePortalRecipient);
  const { data, isLoading, error } = useQuery({ queryKey: ["creator-portal", token], queryFn: () => resolveFn({ data: { token } }) as Promise<any>, retry: false });
  if (isLoading) return <main className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">Loading portal…</main>;
  if (error || !data) return <main className="mx-auto max-w-2xl p-6"><Card><CardContent className="p-6 text-sm text-destructive">This portal link is unavailable.</CardContent></Card></main>;
  const config = data.portal.configuration ?? {};
  const enabled = Object.entries(config.capabilities ?? {}).filter(([, value]) => value === true).map(([key]) => key.replaceAll("_", " "));
  return <main className="min-h-screen bg-muted/30 p-4 md:p-8"><div className="mx-auto max-w-2xl space-y-6">
    <Card><CardHeader><CardTitle>{config.branding?.display_name || data.portal.name}</CardTitle><p className="text-sm text-muted-foreground">{data.portal.description || "A secure portal shared with you by The Coordinator."}</p></CardHeader><CardContent className="space-y-3"><div className="text-sm">Access for <span className="font-medium">{data.recipient.recipient_name}</span> · {data.recipient.recipient_company}</div><Badge variant="outline">{data.portal.portal_type.replaceAll("_", " ")}</Badge></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Available features</CardTitle></CardHeader><CardContent>{enabled.length ? <div className="flex flex-wrap gap-2">{enabled.map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}</div> : <p className="text-sm text-muted-foreground">No features have been enabled yet.</p>}</CardContent></Card>
  </div></main>;
}
