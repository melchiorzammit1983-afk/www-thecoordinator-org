import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { registerServiceWorker } from "@/lib/pwa/register-sw";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { UpdatePrompt } from "@/components/pwa/UpdatePrompt";
import { AskGuideProvider } from "@/components/help/AskGuideProvider";
import { AskGuidePanel } from "@/components/help/AskGuidePanel";
import { SalesChatbot } from "@/components/marketing/SalesChatbot";
// AskGuideFab intentionally not imported — the standalone floating "Ask the Guide"
// entry point is retired in favour of the unified AI dispatch assistant. The Guide
// panel is still available on /help pages via useAskGuide().

const PUBLIC_MARKETING_PREFIXES = ["/request-access", "/demo", "/install", "/help"];
function isMarketingPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_MARKETING_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Crew Change — Operations Console for Transport Companies" },
      { name: "description", content: "Dispatch crew-change transport: approve companies, manage points, generate booking and driver links, and audit every trip." },
      { property: "og:site_name", content: "Crew Change" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Crew Change — Operations Console for Transport Companies" },
      { property: "og:description", content: "Dispatch crew-change transport: approve companies, manage points, generate booking and driver links, and audit every trip." },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Crew Change — Operations Console for Transport Companies" },
      { name: "twitter:description", content: "Dispatch crew-change transport: approve companies, manage points, generate booking and driver links, and audit every trip." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/6f44543c-7ee0-4dc7-bf63-c142062a4045/id-preview-76d32991--39452616-a23d-4f77-ba69-7d9cca7056b0.lovable.app-1782935961163.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/6f44543c-7ee0-4dc7-bf63-c142062a4045/id-preview-76d32991--39452616-a23d-4f77-ba69-7d9cca7056b0.lovable.app-1782935961163.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Crew Change",
          url: "https://transfersmt.lovable.app",
          description: "Operations console for crew-change transport companies.",
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Register the guarded service worker once on mount. The wrapper refuses
  // to register in preview / dev / iframe / `?sw=off` contexts.
  useEffect(() => {
    registerServiceWorker();
  }, []);

  // Swap the manifest link per role so installed PWAs get the right name +
  // icons + start_url. Runs on the client only.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const role: "driver" | "client" | "coordinator" =
      pathname.startsWith("/m/driver") || pathname.startsWith("/coordinator/my-driving")
        ? "driver"
        : pathname.startsWith("/m/client") ||
            pathname.startsWith("/c/") ||
            pathname.startsWith("/t/") ||
            pathname.startsWith("/track/") ||
            pathname.startsWith("/portal/") ||
            pathname.startsWith("/h/")
          ? "client"
          : "coordinator";
    const href = `/manifest.${role}.webmanifest`;
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      document.head.appendChild(link);
    }
    if (link.href.endsWith(href)) return;
    link.href = href;
  }, [pathname]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/*
        AskGuideProvider + AskGuidePanel stay mounted so /help pages
        (HelpArticle, ExplainThis, help.index) can still trigger the guide
        panel via useAskGuide(). The floating <AskGuideFab /> has been
        retired in favour of the unified AI dispatch assistant — its Q&A
        capability is folded into that assistant (see
        src/lib/coordinator-assist.functions.ts). Restore <AskGuideFab />
        here if you ever need the standalone entry point back.
      */}
      <AskGuideProvider>
        <Outlet />
        <Toaster />
        <InstallPrompt />
        <UpdatePrompt />
        <AskGuidePanel />
      </AskGuideProvider>
    </QueryClientProvider>
  );
}


