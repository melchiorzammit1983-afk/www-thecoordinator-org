import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { portalOperationActionSchema } from "@/lib/portal-operation-schemas";
import {
  loadPortalOperations,
  performPortalOperationAction,
  type OperationsAdminClient,
} from "@/lib/portal-operations.server";

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as OperationsAdminClient;
}

async function coordinatorCompanyId(admin: OperationsAdminClient, userId: string) {
  const { data: owned } = await admin
    .from("companies")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (owned?.id) return owned.id as string;
  const { data: linked } = await admin
    .from("drivers")
    .select("company_id")
    .eq("linked_user_id", userId)
    .maybeSingle();
  return (linked?.company_id ?? null) as string | null;
}

async function requireCoordinatorPortal(
  admin: OperationsAdminClient,
  userId: string,
  portalCompanyId: string,
) {
  const companyId = await coordinatorCompanyId(admin, userId);
  if (!companyId) throw new Error("No coordinator company is assigned to this user.");
  const { data, error } = await admin
    .from("portal_companies")
    .select("id,coordinator_company_id,name")
    .eq("id", portalCompanyId)
    .eq("coordinator_company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Company portal not found.");
  return data as { id: string; coordinator_company_id: string; name: string };
}

export const listCoordinatorPortalOperations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ portal_company_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await adminClient();
    const portal = await requireCoordinatorPortal(admin, context.userId, data.portal_company_id);
    return loadPortalOperations(admin, portal);
  });

export const coordinatorPortalOperationAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        portal_company_id: z.string().uuid(),
        operation_action: portalOperationActionSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await adminClient();
    const portal = await requireCoordinatorPortal(admin, context.userId, data.portal_company_id);
    const { data: authUser } = await admin.auth.admin.getUserById(context.userId);
    const metadata = authUser?.user?.user_metadata as
      { full_name?: string; name?: string } | undefined;
    const actorName =
      metadata?.full_name || metadata?.name || authUser?.user?.email || "Coordinator";
    return performPortalOperationAction({
      admin,
      portal,
      side: "coordinator",
      actorUserId: context.userId,
      input: { ...data.operation_action, actor_name: actorName },
    });
  });
