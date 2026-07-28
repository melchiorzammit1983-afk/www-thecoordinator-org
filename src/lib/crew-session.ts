/** Shared sessionStorage helpers for the crew portal (client-side only). */

export const CREW_SESSION_KEY = "crew_session";

export type CrewSession = { jwt: string; expiresAt: number; linkToken: string };

export function readCrewSession(): CrewSession | null {
  try {
    const raw = sessionStorage.getItem(CREW_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CrewSession;
    if (!parsed?.jwt || !parsed?.expiresAt || parsed.expiresAt <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeCrewSession(session: CrewSession) {
  sessionStorage.setItem(CREW_SESSION_KEY, JSON.stringify(session));
}

export function clearCrewSession() {
  sessionStorage.removeItem(CREW_SESSION_KEY);
}

/** Returns the link token even if the session JWT has expired, so we can bounce
 * an expired user back to the login form with their ?token= preserved. */
export function peekCrewLinkToken(): string | null {
  try {
    const raw = sessionStorage.getItem(CREW_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CrewSession>;
    return typeof parsed?.linkToken === "string" && parsed.linkToken.length > 0 ? parsed.linkToken : null;
  } catch {
    return null;
  }
}
