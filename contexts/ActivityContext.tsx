import React, { createContext, useContext, useState } from "react";

interface ActivityContextValue {
  activityFilter: "run" | "ride";
  setActivityFilter: (v: "run" | "ride") => void;
}

const ActivityContext = createContext<ActivityContextValue>({
  activityFilter: "run",
  setActivityFilter: () => {},
});

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const [activityFilter, setActivityFilter] = useState<"run" | "ride">("run");
  return (
    <ActivityContext.Provider value={{ activityFilter, setActivityFilter }}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivity() {
  return useContext(ActivityContext);
}
