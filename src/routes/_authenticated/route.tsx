import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  errorComponent: ({ error }) => {
    const navigate = useNavigate();
    return (
      <div className="min-h-screen grid place-items-center px-4 bg-muted/20">
        <div className="max-w-md text-center bg-background p-8 rounded-xl border shadow-sm">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground mt-2 mb-6">
            {error.message || "We encountered an error while loading the protected area."}
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
            <Button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/auth" });
              }}
            >
              Back to sign in
            </Button>
          </div>
        </div>
      </div>
    );
  },
  component: () => <Outlet />,
});
