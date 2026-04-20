import type { ActivityType } from "@/contexts/ActivityContext";

export type WalkthroughStep = {
  id: string;
  title: string;
  description: string;
  tab: "discover" | "solo" | "crew" | "profile";
  tooltipPosition: "top" | "center" | "bottom";
  isFullScreen?: boolean;
};

function labelFor(a: ActivityType) {
  if (a === "ride") return { noun: "ride", noun_plural: "rides", Noun: "Ride", Noun_plural: "Rides", paceWord: "speed", Pacer: "Speed", noun_verb: "riding", person: "rider", person_plural: "riders" };
  if (a === "walk") return { noun: "walk", noun_plural: "walks", Noun: "Walk", Noun_plural: "Walks", paceWord: "pace", Pacer: "Pace", noun_verb: "walking", person: "walker", person_plural: "walkers" };
  return { noun: "run", noun_plural: "runs", Noun: "Run", Noun_plural: "Runs", paceWord: "pace", Pacer: "Pace", noun_verb: "running", person: "runner", person_plural: "runners" };
}

export function getWalkthroughSteps(activity: ActivityType = "run"): WalkthroughStep[] {
  const L = labelFor(activity);
  return [
    {
      id: "welcome",
      title: "Welcome to PaceUp",
      description: "Quick tour of the essentials. Takes about a minute.",
      tab: "discover",
      tooltipPosition: "center",
      isFullScreen: true,
    },
    {
      id: "activity-toggle",
      title: "Run, ride, or walk",
      description: `Switch activities any time. We'll lead with ${L.noun_plural} since that's your default.`,
      tab: "discover",
      tooltipPosition: "top",
    },
    {
      id: "event-cards",
      title: `${L.Noun_plural} near you`,
      description: `Each card shows ${L.paceWord}, distance, and the host. Tap to open.`,
      tab: "discover",
      tooltipPosition: "center",
    },
    {
      id: "map-view",
      title: "Map view",
      description: `See nearby ${L.noun_plural} pinned on a map.`,
      tab: "discover",
      tooltipPosition: "top",
    },
    {
      id: "planning-to-come",
      title: "One-tap RSVP",
      description: "Tap Planning to Come — the host knows you're in.",
      tab: "discover",
      tooltipPosition: "bottom",
    },
    {
      id: "bookmark",
      title: "Save for later",
      description: "Bookmark anything that catches your eye.",
      tab: "discover",
      tooltipPosition: "center",
    },
    {
      id: "solo-intro",
      title: `Track a solo ${L.noun}`,
      description: `Live GPS, pace, and splits — all in one tap.`,
      tab: "solo",
      tooltipPosition: "center",
    },
    {
      id: "saved-paths",
      title: "Your saved paths",
      description: `Every route saves automatically. Reuse them to host.`,
      tab: "solo",
      tooltipPosition: "center",
    },
    {
      id: "solo-history",
      title: `${L.Noun} history`,
      description: "Tap any workout to see the route, splits, and your rank.",
      tab: "solo",
      tooltipPosition: "bottom",
    },
    {
      id: "crew-intro",
      title: "Crews are your squad",
      description: "Join or start a crew to run, chat, and compete together.",
      tab: "crew",
      tooltipPosition: "center",
    },
    {
      id: "pace-groups",
      title: activity === "ride" ? "Speed groups" : "Pace groups",
      description: activity === "ride"
        ? "Hosting a big ride? Set A/B/C speed tiers so nobody gets dropped."
        : `Hosting a big group? Split into ${L.paceWord} tiers so nobody gets dropped.`,
      tab: "crew",
      tooltipPosition: "center",
    },
    {
      id: "rankings",
      title: "Crew leaderboards",
      description: "See how your crew stacks up against others at every distance.",
      tab: "crew",
      tooltipPosition: "bottom",
    },
    {
      id: "profile-intro",
      title: "Your profile",
      description: "Stats, PRs, and history — all in one place.",
      tab: "profile",
      tooltipPosition: "top",
    },
    {
      id: "friends",
      title: "Find your people",
      description: `Add friends to see their ${L.noun_plural} and compare stats.`,
      tab: "profile",
      tooltipPosition: "center",
    },
    {
      id: "goals",
      title: "Set your goals",
      description: "Monthly and yearly targets to keep you moving.",
      tab: "profile",
      tooltipPosition: "center",
    },
    {
      id: "achievements",
      title: "Earn badges",
      description: `PRs, milestones, streaks — badges unlock as you go. You're all set!`,
      tab: "profile",
      tooltipPosition: "bottom",
    },
  ];
}

export const WALKTHROUGH_STEPS: WalkthroughStep[] = getWalkthroughSteps("run");
