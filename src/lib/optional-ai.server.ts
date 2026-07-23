/**
 * Master server-side lock for the optional AI module.
 *
 * Keep this disabled while the core transport platform is being rebuilt.
 * Future AI providers must be integrated behind normal application actions
 * and business-rule checks before this can be enabled again.
 */
export const OPTIONAL_AI_MODULE_ENABLED = false;

export function isOptionalAiModuleEnabled(): boolean {
  return OPTIONAL_AI_MODULE_ENABLED;
}

export function assertOptionalAiModuleEnabled(): void {
  if (!OPTIONAL_AI_MODULE_ENABLED) {
    throw new Error("The optional AI module is currently disabled.");
  }
}
