import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WALKTHROUGH_STEPS } from "@/lib/walkthroughConfig";
import { useAuth } from "@/contexts/AuthContext";

function storageKey(userId: string) {
  return `@paceup_walkthrough_completed_${userId}`;
}

interface WalkthroughContextType {
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  startWalkthrough: () => void;
  nextStep: () => void;
  skipWalkthrough: () => void;
  currentStepConfig: typeof WALKTHROUGH_STEPS[number] | null;
}

const WalkthroughContext = createContext<WalkthroughContextType>({
  isActive: false,
  currentStep: 0,
  totalSteps: WALKTHROUGH_STEPS.length,
  startWalkthrough: () => {},
  nextStep: () => {},
  skipWalkthrough: () => {},
  currentStepConfig: null,
});

export function useWalkthrough() {
  return useContext(WalkthroughContext);
}

export function WalkthroughProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const checkedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      setIsActive(false);
      setCurrentStep(0);
      checkedUserId.current = null;
      return;
    }
    if (checkedUserId.current === user.id) return;
    checkedUserId.current = user.id;
    const timer = setTimeout(() => {
      AsyncStorage.getItem(storageKey(user.id))
        .then((val) => {
          if (val !== "true") {
            setCurrentStep(0);
            setIsActive(true);
          }
        })
        .catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [user]);

  const completeWalkthrough = useCallback(() => {
    setIsActive(false);
    setCurrentStep(0);
    if (user) {
      AsyncStorage.setItem(storageKey(user.id), "true").catch(() => {});
    }
  }, [user]);

  const startWalkthrough = useCallback(() => {
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const nextStep = useCallback(() => {
    if (currentStep >= WALKTHROUGH_STEPS.length - 1) {
      completeWalkthrough();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  }, [currentStep, completeWalkthrough]);

  const skipWalkthrough = useCallback(() => {
    completeWalkthrough();
  }, [completeWalkthrough]);

  const currentStepConfig = isActive ? WALKTHROUGH_STEPS[currentStep] ?? null : null;

  return (
    <WalkthroughContext.Provider
      value={{
        isActive,
        currentStep,
        totalSteps: WALKTHROUGH_STEPS.length,
        startWalkthrough,
        nextStep,
        skipWalkthrough,
        currentStepConfig,
      }}
    >
      {children}
    </WalkthroughContext.Provider>
  );
}
