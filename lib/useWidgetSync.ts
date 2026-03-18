import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { updateWidget } from "@/lib/widgetBridge";

interface SoloRun {
  id: string;
  date: string;
  distance_miles: number;
  completed?: boolean;
  activity_type?: string;
}

interface Run {
  id: string;
  title: string;
  date: string;
  is_completed?: boolean;
  min_distance: number;
  max_distance: number;
}

function getCalendarWeekStart(): Date {
  const now = new Date();
  const d = new Date(now);
  d.setDate(now.getDate() - now.getDay()); // Sunday = start of week
  d.setHours(0, 0, 0, 0);
  return d;
}

export function useWidgetSync() {
  const { user } = useAuth();

  const { data: soloRuns = [] } = useQuery<SoloRun[]>({
    queryKey: ["/api/solo-runs"],
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: runs = [] } = useQuery<Run[]>({
    queryKey: ["/api/runs"],
    enabled: !!user,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!user) return;

    // True calendar-week mileage (Sunday–Saturday)
    const weekStart = getCalendarWeekStart();
    const weeklyMiles = soloRuns
      .filter((r) => r.completed && new Date(r.date) >= weekStart)
      .reduce((s, r) => s + r.distance_miles, 0);

    // Soonest upcoming run (future, not completed)
    const upcoming = [...runs]
      .filter((r) => !r.is_completed && new Date(r.date).getTime() > Date.now())
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const next = upcoming[0];

    const distRange = next
      ? next.min_distance === next.max_distance
        ? `${next.min_distance}`
        : `${next.min_distance}–${next.max_distance}`
      : "";

    updateWidget({
      weeklyMiles,
      monthlyGoal: user.monthly_goal ?? 50,
      nextRunTitle: next?.title ?? "",
      nextRunTimestamp: next ? new Date(next.date).getTime() / 1000 : 0,
      distanceRangeMiles: distRange,
    });
  }, [soloRuns, runs, user]);
}
