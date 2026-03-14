import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { Platform } from "react-native";
import { useAuth } from "@/contexts/AuthContext";

interface RevenueCatProduct {
  identifier: string;
}

interface RevenueCatPackage {
  product: RevenueCatProduct;
}

interface RevenueCatOffering {
  availablePackages: RevenueCatPackage[];
}

interface RevenueCatEntitlements {
  active: Record<string, unknown>;
}

interface RevenueCatCustomerInfo {
  entitlements: RevenueCatEntitlements;
}

interface RevenueCatSDK {
  configure: (config: { apiKey: string }) => void;
  logIn: (userId: string) => Promise<{ customerInfo: RevenueCatCustomerInfo }>;
  getCustomerInfo: () => Promise<RevenueCatCustomerInfo>;
  getOfferings: () => Promise<{ current: RevenueCatOffering | null }>;
  purchasePackage: (pkg: RevenueCatPackage) => Promise<{ customerInfo: RevenueCatCustomerInfo }>;
  restorePurchases: () => Promise<RevenueCatCustomerInfo>;
}

let PurchasesSDK: RevenueCatSDK | null = null;
if (Platform.OS !== "web") {
  try {
    PurchasesSDK = require("react-native-purchases").default as RevenueCatSDK;
  } catch {}
}

const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || "appl_PLACEHOLDER_IOS_KEY";
const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || "goog_PLACEHOLDER_ANDROID_KEY";

interface PurchasesContextValue {
  isReady: boolean;
  activeEntitlements: string[];
  hasEntitlement: (id: string) => boolean;
  purchasePackage: (productId: string, crewId?: string) => Promise<boolean>;
  restorePurchases: () => Promise<void>;
}

const PurchasesContext = createContext<PurchasesContextValue>({
  isReady: false,
  activeEntitlements: [],
  hasEntitlement: () => false,
  purchasePackage: async () => false,
  restorePurchases: async () => {},
});

export function PurchasesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [isReady, setIsReady] = useState(false);
  const [activeEntitlements, setActiveEntitlements] = useState<string[]>([]);

  useEffect(() => {
    if (!PurchasesSDK || Platform.OS === "web") {
      setIsReady(true);
      return;
    }

    async function init() {
      try {
        const apiKey = Platform.OS === "ios" ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
        if (apiKey.includes("PLACEHOLDER")) {
          setIsReady(true);
          return;
        }
        PurchasesSDK!.configure({ apiKey });
        if (user?.id) {
          await PurchasesSDK!.logIn(user.id);
        }
        const customerInfo = await PurchasesSDK!.getCustomerInfo();
        const entitlements = Object.keys(customerInfo?.entitlements?.active || {});
        setActiveEntitlements(entitlements);
      } catch (e) {
        console.warn("[PurchasesProvider] init error:", e);
      }
      setIsReady(true);
    }

    init();
  }, [user?.id]);

  const hasEntitlement = useCallback(
    (id: string) => activeEntitlements.includes(id),
    [activeEntitlements]
  );

  const purchasePackage = useCallback(async (productId: string, crewId?: string): Promise<boolean> => {
    if (!PurchasesSDK || Platform.OS === "web") return false;
    try {
      if (crewId) {
        await PurchasesSDK.logIn(`crew_${crewId}`);
      }
      const offerings = await PurchasesSDK.getOfferings();
      const current = offerings?.current;
      if (!current) return false;
      const pkg = current.availablePackages?.find(
        (p: RevenueCatPackage) => p.product?.identifier === productId
      );
      if (!pkg) return false;
      const { customerInfo } = await PurchasesSDK.purchasePackage(pkg);
      const entitlements = Object.keys(customerInfo?.entitlements?.active || {});
      setActiveEntitlements(entitlements);
      if (crewId && user?.id) {
        await PurchasesSDK.logIn(user.id);
      }
      return true;
    } catch (e) {
      console.warn("[PurchasesProvider] purchase error:", e);
      if (crewId && user?.id) {
        try { await PurchasesSDK.logIn(user.id); } catch {}
      }
      return false;
    }
  }, [user?.id]);

  const restorePurchases = useCallback(async () => {
    if (!PurchasesSDK || Platform.OS === "web") return;
    try {
      const customerInfo = await PurchasesSDK.restorePurchases();
      const entitlements = Object.keys(customerInfo?.entitlements?.active || {});
      setActiveEntitlements(entitlements);
    } catch (e) {
      console.warn("[PurchasesProvider] restore error:", e);
    }
  }, []);

  const value = useMemo(
    () => ({ isReady, activeEntitlements, hasEntitlement, purchasePackage, restorePurchases }),
    [isReady, activeEntitlements, hasEntitlement, purchasePackage, restorePurchases]
  );

  return (
    <PurchasesContext.Provider value={value}>
      {children}
    </PurchasesContext.Provider>
  );
}

export function usePurchases() {
  return useContext(PurchasesContext);
}
