import React, { createContext, useContext, useCallback } from "react";

interface WalkthroughContextType {
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  startWalkthrough: () => void;
  nextStep: () => void;
  skipWalkthrough: () => void;
  currentStepConfig: null;
}

const WalkthroughContext = createContext<WalkthroughContextType>({
  isActive: false,
  currentStep: 0,
  totalSteps: 0,
  startWalkthrough: () => {},
  nextStep: () => {},
  skipWalkthrough: () => {},
  currentStepConfig: null,
});

export function useWalkthrough() {
  return useContext(WalkthroughContext);
}

export function WalkthroughProvider({ children }: { children: React.ReactNode }) {
  const noop = useCallback(() => {}, []);
  return (
    <WalkthroughContext.Provider
      value={{
        isActive: false,
        currentStep: 0,
        totalSteps: 0,
        startWalkthrough: noop,
        nextStep: noop,
        skipWalkthrough: noop,
        currentStepConfig: null,
      }}
    >
      {children}
    </WalkthroughContext.Provider>
  );
}
