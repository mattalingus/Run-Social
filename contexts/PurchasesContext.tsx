import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { Platform } from "react-native";
import { useAuth } from "@/contexts/AuthContext";

interface RevenueCatProduct {
  identifier: string;
  priceString?: string;
}

interface RevenueCatPackage {
  identifier: string;
  product: RevenueCatProduct;
}

interface RevenueCatOffering {
  availablePackages: RevenueCatPackage[];
}

interface RevenueCatOfferings {
  current: RevenueCatOffering | null;
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
  getOfferings: () => Promise<RevenueCatOfferings>;
  purchasePackage: (pkg: RevenueCatPackage) => Promise<{ customerInfo: RevenueCatCustomerInfo }>;
  restorePurchases: () => Promise<RevenueCatCustomerInfo>;
}

let PurchasesSDK: RevenueCatSDK | null = null;
if (Platform.OS !== "web") {
  try {
    PurchasesSDK = require("react-native-purchases").default as RevenueCatSDK;
  } catch {}
}

const REVENUECAT_TEST_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY ?? "";
const REVENUECAT_IOS_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ||
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ||
  "";
const REVENUECAT_ANDROID_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ||
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ||
  "";

function getApiKey(): string {
  if (Platform.OS === "ios") return REVENUECAT_IOS_KEY || REVENUECAT_TEST_KEY;
  if (Platform.OS === "android") return REVENUECAT_ANDROID_KEY || REVENUECAT_TEST_KEY;
  return REVENUECAT_TEST_KEY;
}

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
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    if (!PurchasesSDK || Platform.OS === "web") {
      setIsReady(true);
      return;
    }

    async function init() {
      try {
        const apiKey = getApiKey();
        if (!apiKey) {
          console.warn("[PurchasesProvider] No RevenueCat API key found — skipping init");
          setIsReady(true);
          return;
        }

        if (!configured) {
          PurchasesSDK!.configure({ apiKey });
          setConfigured(true);
        }

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
    const apiKey = getApiKey();
    if (!apiKey) return false;
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
  }, [user?.id, configured]);

  const restorePurchases = useCallback(async () => {
    if (!PurchasesSDK || Platform.OS === "web") return;
    const apiKey = getApiKey();
    if (!apiKey) return;
    try {
      const customerInfo = await PurchasesSDK.restorePurchases();
      const entitlements = Object.keys(customerInfo?.entitlements?.active || {});
      setActiveEntitlements(entitlements);
    } catch (e) {
      console.warn("[PurchasesProvider] restore error:", e);
      throw e;
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
