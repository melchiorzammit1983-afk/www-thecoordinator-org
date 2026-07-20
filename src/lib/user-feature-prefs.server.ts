/**
 * Server-side gate check for user-level feature preferences.
 *
 * Call BEFORE spend_points in every paid-feature server fn. Throws with a
 * message the UI can decode:
 *   "feature_disabled_by_user:<key>"  — coordinator opted out in settings
 *
 * Admin entitlement / billing plan gating is enforced separately by
 * `feature_available()` and `spend_points()` in the DB. We do not re-check
 * that here; this only adds the user opt-out layer.
 */
export async function assertUserFeatureEnabled(
  supabaseAdmin: any,
  companyId: string,
  featureKey: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("user_feature_preferences")
    .select("enabled")
    .eq("company_id", companyId)
    .eq("feature_key", featureKey)
    .maybeSingle();
  if (error) return; // fail-open on infra hiccup; RLS/entitlement still guards
  if (data && data.enabled === false) {
    throw new Error(`feature_disabled_by_user:${featureKey}`);
  }
}

export function friendlyGateError(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (msg.startsWith("feature_disabled_by_user:")) {
    return "You've turned this feature off in Settings → Feature usage. Turn it back on to use it.";
  }
  if (msg === "feature_disabled" || msg === "feature_capped") {
    return "This feature is disabled by your admin (billing plan). Contact support to enable it.";
  }
  return null;
}
