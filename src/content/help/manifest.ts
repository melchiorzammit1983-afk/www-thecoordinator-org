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
// Explicit imports (Vite requires static specifiers for tree-shaking).
const A = {
  welcome: lazy(() => import("./articles/welcome")),
  "install-apps": lazy(() => import("./articles/install-apps")),
  "coordinator-dashboard": lazy(() => import("./articles/coordinator-dashboard")),
  "coordinator-dispatch": lazy(() => import("./articles/coordinator-dispatch")),
  "driver-guide": lazy(() => import("./articles/driver-guide")),
  "event-catalog": lazy(() => import("./articles/event-catalog")),
  faq: lazy(() => import("./articles/faq")),
} as const;

type Slug = keyof typeof A;
const load = (slug: Slug) => A[slug];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "welcome",
    title: "Welcome to The Coordinator",
    group: "Getting started",
    roles: ["everyone"],
    summary: "What this platform does and who it's for.",
    keywords: ["intro", "overview", "start"],
    component: load("welcome"),
  },
  {
    slug: "install-apps",
    title: "Install the apps",
    group: "Getting started",
    roles: ["everyone"],
    summary: "Driver Android APK, and PWA install for coordinators and clients.",
    keywords: ["install", "apk", "pwa", "download"],
    component: load("install-apps"),
  },
  {
    slug: "coordinator-dashboard",
    title: "The coordinator dashboard",
    group: "Coordinator",
    roles: ["coordinator"],
    summary: "Quick actions, activity feed, and live ETAs.",
    keywords: ["dashboard", "home", "activity"],
    component: load("coordinator-dashboard"),
  },
  {
    slug: "coordinator-dispatch",
    title: "Dispatch, calendar & schedule conflicts",
    group: "Coordinator",
    roles: ["coordinator"],
    summary: "How the dense dispatch view works: chain reflow, ETA chips, red-glow conflict detection, and alternative driver suggestions.",
    keywords: ["dispatch", "calendar", "conflict", "red", "assign", "buffer"],
    component: load("coordinator-dispatch"),
  },
  {
    slug: "driver-guide",
    title: "Driver walkthrough",
    group: "Driver",
    roles: ["driver"],
    summary: "First-time setup, the trip screen, status buttons, waiting time, and how each action affects your trust score and payout.",
    keywords: ["driver", "status", "waiting", "trust", "payout"],
    component: load("driver-guide"),
  },
  {
    slug: "event-catalog",
    title: "Trip event catalog",
    group: "Concepts",
    roles: ["everyone"],
    summary: "Every event the system logs — and its exact effect on driver trust and trip payout.",
    keywords: ["events", "map", "audit", "trust", "payout"],
    component: load("event-catalog"),
  },
  {
    slug: "faq",
    title: "FAQ & troubleshooting",
    group: "Help",
    roles: ["everyone"],
    summary: "Common questions: why is the card red, why isn't ETA updating, GPS off, wrong status.",
    keywords: ["faq", "troubleshoot", "help", "red", "eta", "gps"],
    component: load("faq"),
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
