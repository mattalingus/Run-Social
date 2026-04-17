import React, { createContext, useContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/contexts/AuthContext";

export type ActivityType = "run" | "ride" | "walk";

const ACTIVITY_STORAGE_KEY = "@paceup_default_activity";

function isValidActivity(v: string | null | undefined): v is ActivityType {
  return v === "run" || v === "ride" || v === "walk";
}

interface ActivityContextValue {
  activityFilter: ActivityType;
  setActivityFilter: (v: ActivityType) => void;
}

const ActivityContext = createContext<ActivityContextValue>({
  activityFilter: "run",
  setActivityFilter: () => {},
});

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [activityFilter, setActivityFilterState] = useState<ActivityType>("run");
  const [storageChecked, setStorageChecked] = useState(false);
  const [storedValue, setStoredValue] = useState<ActivityType | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ACTIVITY_STORAGE_KEY)
      .then((stored) => {
        if (isValidActivity(stored)) {
          setStoredValue(stored);
          setActivityFilterState(stored);
        }
      })
      .catch(() => {})
      .finally(() => setStorageChecked(true));
  }, []);

  useEffect(() => {
    if (!storageChecked) return;
    if (storedValue !== null) return;
    if (user && isValidActivity(user.default_activity)) {
      setActivityFilterState(user.default_activity);
    }
  }, [storageChecked, storedValue, user]);

  function setActivityFilter(v: ActivityType) {
    setActivityFilterState(v);
    setStoredValue(v);
    AsyncStorage.setItem(ACTIVITY_STORAGE_KEY, v).catch(() => {});
  }

  return (
    <ActivityContext.Provider value={{ activityFilter, setActivityFilter }}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivity() {
  return useContext(ActivityContext);
}

export function activityLabel(type: string | null | undefined, form: "noun" | "verb" | "plural" | "adjective" = "noun"): string {
  const t = type ?? "run";
  if (form === "noun") {
    if (t === "ride") return "Ride";
    if (t === "walk") return "Walk";
    return "Run";
  }
  if (form === "plural") {
    if (t === "ride") return "Rides";
    if (t === "walk") return "Walks";
    return "Runs";
  }
  if (form === "verb") {
    if (t === "ride") return "ride";
    if (t === "walk") return "walk";
    return "run";
  }
  if (form === "adjective") {
    if (t === "ride") return "riding";
    if (t === "walk") return "walking";
    return "running";
  }
  return "run";
}

export function activityIcon(type: string | null | undefined): string {
  if (type === "ride") return "bicycle";
  if (type === "walk") return "footsteps";
  return "body";
}

export function activityIconOutline(type: string | null | undefined): string {
  if (type === "ride") return "bicycle-outline";
  if (type === "walk") return "footsteps-outline";
  return "body-outline";
}
