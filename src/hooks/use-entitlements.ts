import { useMyBilling } from "@/hooks/use-features";

/**
 * Unified plan/entitlement helpers built on top of the single-wallet billing model
 * introduced by the pricing consolidation migration.
 */

const PLAN_ORDER: Record<string, number> = {
  trial: 4, // trial gets everything while it lasts
  business: 3,
  pro: 2,
  starter: 1,
};

export type PlanCode = "trial" | "starter" | "pro" | "business";

export function useEntitlements() {
  const { data, isLoading } = useMyBilling();
  const planCode = (data?.subscription?.plans as { code?: string } | undefined)?.code as PlanCode | undefined;
  const trialEndsAt = (data?.company as { trial_ends_at?: string | null } | null | undefined)?.trial_ends_at ?? null;
  const graceLeft = Number((data?.company as { grace_actions_remaining?: number } | null | undefined)?.grace_actions_remaining ?? 0);
  const planPts = Number(data?.subscription?.points_remaining_this_period ?? 0);
  const balancePts = Number(data?.company?.points_balance ?? 0);
  const wallet = planPts + balancePts;

  const trialActive = trialEndsAt ? new Date(trialEndsAt) > new Date() : false;

  function hasPlan(min: PlanCode): boolean {
    if (isLoading) return true; // optimistic — let server enforce
    if (trialActive) return true;
    const p = planCode ?? "starter";
    return (PLAN_ORDER[p] ?? 0) >= (PLAN_ORDER[min] ?? 0);
  }

  function canUse(feature: { min_plan_code?: string | null }): boolean {
    if (!feature.min_plan_code) return true;
    return hasPlan(feature.min_plan_code as PlanCode);
  }

  return {
    isLoading,
    planCode,
    trialActive,
    trialEndsAt,
    graceLeft,
    wallet,
    planPts,
    balancePts,
    hasPlan,
    canUse,
  };
}
