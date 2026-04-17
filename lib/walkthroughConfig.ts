export type WalkthroughStep = {
  id: string;
  title: string;
  description: string;
  tab: "discover" | "solo" | "crew" | "profile";
  tooltipPosition: "top" | "center" | "bottom";
  isFullScreen?: boolean;
};

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: "welcome",
    title: "Welcome to Pace Up",
    description: "Your social running companion. Find group runs, track solo workouts, and connect with your crew. Let's take a quick tour!",
    tab: "discover",
    tooltipPosition: "center",
    isFullScreen: true,
  },
  {
    id: "activity-toggle",
    title: "Run, Ride, or Walk",
    description: "Switch between runs, rides, and walks to find the activities that match your style.",
    tab: "discover",
    tooltipPosition: "top",
  },
  {
    id: "event-cards",
    title: "Upcoming Events",
    description: "Browse nearby group runs, rides, and walks. See the pace, distance, host info, and who's going.",
    tab: "discover",
    tooltipPosition: "center",
  },
  {
    id: "bookmark",
    title: "Save for Later",
    description: "Tap the bookmark icon to save events you're interested in. Access them anytime from your profile.",
    tab: "discover",
    tooltipPosition: "center",
  },
  {
    id: "planning-to-come",
    title: "Planning to Come",
    description: "Tap 'Planning to Come' to RSVP and let others know you'll be there. The host gets notified too!",
    tab: "discover",
    tooltipPosition: "bottom",
  },
  {
    id: "map-view",
    title: "Map View",
    description: "Toggle map view to see all events near you on a map. Great for finding runs in your neighborhood.",
    tab: "discover",
    tooltipPosition: "top",
  },
  {
    id: "solo-intro",
    title: "Solo Workouts",
    description: "Track your solo runs, rides, and walks with live GPS. See your pace, distance, and route in real time.",
    tab: "solo",
    tooltipPosition: "center",
  },
  {
    id: "solo-history",
    title: "Run History",
    description: "All your completed workouts are saved here. Review your stats, routes, and progress over time.",
    tab: "solo",
    tooltipPosition: "bottom",
  },
  {
    id: "crew-intro",
    title: "Form Your Squad",
    description: "Crews are your running squads. Create or join a crew to host private events, chat, and compete together.",
    tab: "crew",
    tooltipPosition: "center",
  },
  {
    id: "crew-cta",
    title: "Join or Create a Crew",
    description: "Start your own crew or join an existing one. Invite friends and build your running community.",
    tab: "crew",
    tooltipPosition: "center",
  },
  {
    id: "crew-chat",
    title: "Crew Chat",
    description: "Every crew has a built-in group chat. Coordinate plans, share motivation, and stay connected.",
    tab: "crew",
    tooltipPosition: "center",
  },
  {
    id: "rankings",
    title: "Rankings",
    description: "See how you stack up! Rankings track your best times across popular distances like 1 Mile, 5K, and 10K — or best speeds for 10 to 100 mile rides.",
    tab: "crew",
    tooltipPosition: "bottom",
  },
  {
    id: "profile-intro",
    title: "Your Profile",
    description: "View your stats, personal records, and activity history all in one place.",
    tab: "profile",
    tooltipPosition: "top",
  },
  {
    id: "friends",
    title: "Friends",
    description: "Add friends to see their activity, compare stats, and find each other's group runs.",
    tab: "profile",
    tooltipPosition: "center",
  },
  {
    id: "goals",
    title: "Set Your Goals",
    description: "Set monthly and yearly distance goals to stay motivated. Track your progress right from your profile.",
    tab: "profile",
    tooltipPosition: "center",
  },
  {
    id: "achievements",
    title: "Achievements",
    description: "Earn badges as you hit milestones — your first run or ride, distance PRs, speed achievements, streaks, and more. You're all set!",
    tab: "profile",
    tooltipPosition: "bottom",
  },
];
