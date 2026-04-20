import React, { createContext, useContext, useCallback, useState, useMemo, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getWalkthroughSteps, type WalkthroughStep } from "@/lib/walkthroughConfig";
import { useActivity } from "@/contexts/ActivityContext";

const WALKTHROUGH_SEEN_KEY = "@paceup_walkthrough_seen";

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WalkthroughContextType {
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  startWalkthrough: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipWalkthrough: () => void;
  currentStepConfig: WalkthroughStep | null;
  targetRect: TargetRect | null;
  registerTarget: (stepId: string, rect: TargetRect | null) => void;
}

const WalkthroughContext = createContext<WalkthroughContextType>({
  isActive: false,
  currentStep: 0,
  totalSteps: 0,
  startWalkthrough: () => {},
  nextStep: () => {},
  prevStep: () => {},
  skipWalkthrough: () => {},
  currentStepConfig: null,
  targetRect: null,
  registerTarget: () => {},
});

export function useWalkthrough() {
  return useContext(WalkthroughContext);
}

export function WalkthroughProvider({ children }: { children: React.ReactNode }) {
  const { activityFilter } = useActivity();
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const activeStepIdRef = useRef<string | null>(null);

  const steps = useMemo(() => getWalkthroughSteps(activityFilter), [activityFilter]);
  const currentStepConfig = isActive ? steps[currentStep] ?? null : null;

  // Track which stepId is live so only matching pulses can register.
  activeStepIdRef.current = currentStepConfig?.id ?? null;

  const registerTarget = useCallback((stepId: string, rect: TargetRect | null) => {
    if (stepId !== activeStepIdRef.current) return;
    setTargetRect(rect);
  }, []);

  const startWalkthrough = useCallback(() => {
    setTargetRect(null);
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const endWalkthrough = useCallback(() => {
    setIsActive(false);
    setCurrentStep(0);
    setTargetRect(null);
    AsyncStorage.setItem(WALKTHROUGH_SEEN_KEY, "true").catch(() => {});
  }, []);

  const nextStep = useCallback(() => {
    setTargetRect(null);
    setCurrentStep((prev) => {
      const nxt = prev + 1;
      if (nxt >= steps.length) {
        setIsActive(false);
        AsyncStorage.setItem(WALKTHROUGH_SEEN_KEY, "true").catch(() => {});
        return 0;
      }
      return nxt;
    });
  }, [steps.length]);

  const prevStep = useCallback(() => {
    setTargetRect(null);
    setCurrentStep((p) => Math.max(0, p - 1));
  }, []);

  const skipWalkthrough = useCallback(() => {
    endWalkthrough();
  }, [endWalkthrough]);

  return (
    <WalkthroughContext.Provider
      value={{
        isActive,
        currentStep,
        totalSteps: steps.length,
        startWalkthrough,
        nextStep,
        prevStep,
        skipWalkthrough,
        currentStepConfig,
        targetRect,
        registerTarget,
      }}
    >
      {children}
    </WalkthroughContext.Provider>
  );
}
