import type { ComponentType } from "react";
import { lazy } from "react";

export type HelpRole = "coordinator" | "driver" | "client" | "admin" | "everyone";

export type HelpArticle = {
  slug: string;
  title: string;
  group: string;
  roles: HelpRole[];
  summary: string;
  keywords: string[];
  component: ComponentType;
};

// Lazy so bundle stays lean; each article is its own chunk.
const A = (path: string) =>
  lazy(() => import(/* @vite-ignore */ `./articles/${path}.tsx`));

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "welcome",
    title: "Welcome to The Coordinator",
    group: "Getting started",
    roles: ["everyone"],
    summary: "What this platform does and who it's for.",
    keywords: ["intro", "overview", "start"],
    component: A("welcome"),
  },
  {
    slug: "install-apps",
    title: "Install the apps",
    group: "Getting started",
    roles: ["everyone"],
    summary: "Driver Android APK, and PWA install for coordinators and clients.",
    keywords: ["install", "apk", "pwa", "download"],
    component: A("install-apps"),
  },
  {
    slug: "coordinator-dashboard",
    title: "The coordinator dashboard",
    group: "Coordinator",
    roles: ["coordinator"],
    summary: "Quick actions, activity feed, and live ETAs.",
    keywords: ["dashboard", "home", "activity"],
    component: A("coordinator-dashboard"),
  },
  {
    slug: "coordinator-dispatch",
    title: "Dispatch, calendar & schedule conflicts",
    group: "Coordinator",
    roles: ["coordinator"],
    summary: "How the dense dispatch view works: chain reflow, ETA chips, red-glow conflict detection, and alternative driver suggestions.",
    keywords: ["dispatch", "calendar", "conflict", "red", "assign", "buffer"],
    component: A("coordinator-dispatch"),
  },
  {
    slug: "coordinator-ai-extraction",
    title: "AI trip extraction",
    group: "Coordinator",
    roles: ["coordinator"],
    summary: "Paste an email or booking, let AI turn it into structured trips. Includes retries, cost, and error handling.",
    keywords: ["ai", "extraction", "paste", "email", "bulk", "gemini"],
    component: A("coordinator-ai-extraction"),
  },
  {
    slug: "driver-guide",
    title: "Driver walkthrough",
    group: "Driver",
    roles: ["driver"],
    summary: "First-time setup, the trip screen, status buttons, waiting time, and how each action affects your trust score and payout.",
    keywords: ["driver", "status", "waiting", "trust", "payout"],
    component: A("driver-guide"),
  },
  {
    slug: "event-catalog",
    title: "Trip event catalog",
    group: "Concepts",
    roles: ["everyone"],
    summary: "Every event the system logs — and its exact effect on driver trust and trip payout.",
    keywords: ["events", "map", "audit", "trust", "payout"],
    component: A("event-catalog"),
  },
  {
    slug: "faq",
    title: "FAQ & troubleshooting",
    group: "Help",
    roles: ["everyone"],
    summary: "Common questions: why is the card red, why isn't ETA updating, GPS off, wrong status.",
    keywords: ["faq", "troubleshoot", "help", "red", "eta", "gps"],
    component: A("faq"),
  },
];

export const HELP_GROUPS = Array.from(
  new Set(HELP_ARTICLES.map((a) => a.group)),
);

export function getArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}

export function getPrevNext(slug: string) {
  const idx = HELP_ARTICLES.findIndex((a) => a.slug === slug);
  return {
    prev: idx > 0 ? HELP_ARTICLES[idx - 1] : null,
    next: idx >= 0 && idx < HELP_ARTICLES.length - 1 ? HELP_ARTICLES[idx + 1] : null,
  };
}
