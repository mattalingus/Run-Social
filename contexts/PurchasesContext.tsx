import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { Platform } from "react-native";
import { useAuth } from "@/contexts/AuthContext";

export interface RCProduct {
  identifier: string;
  priceString?: string;
  price?: number;
  currencyCode?: string;
  subscriptionPeriod?: string;
}

export interface RCPackage {
  identifier: string;
  product: RCProduct;
}

export interface RCOffering {
  identifier: string;
  availablePackages: RCPackage[];
}

export interface RCOfferings {
  current: RCOffering | null;
  all: Record<string, RCOffering>;
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
  getOfferings: () => Promise<RCOfferings>;
  purchasePackage: (pkg: RCPackage) => Promise<{ customerInfo: RevenueCatCustomerInfo }>;
  restorePurchases: () => Promise<RevenueCatCustomerInfo>;
}

let PurchasesSDK: RevenueCatSDK | null = null;
if (Platform.OS !== "web") {
  try {
    PurchasesSDK = require("react-native-purchases").default as RevenueCatSDK;
  } catch {}
}

const REVENUECAT_TEST_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY ?? "";
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
  offerings: RCOfferings | null;
  hasEntitlement: (id: string) => boolean;
  getPriceString: (productId: string) => string | null;
  purchasePackage: (productId: string, crewId?: string) => Promise<boolean>;
  restorePurchases: () => Promise<void>;
  refreshEntitlements: () => Promise<void>;
}

const PurchasesContext = createContext<PurchasesContextValue>({
  isReady: false,
  activeEntitlements: [],
  offerings: null,
  hasEntitlement: () => false,
  getPriceString: () => null,
  purchasePackage: async () => false,
  restorePurchases: async () => {},
  refreshEntitlements: async () => {},
});

export function PurchasesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [isReady, setIsReady] = useState(false);
  const [activeEntitlements, setActiveEntitlements] = useState<string[]>([]);
  const [offerings, setOfferings] = useState<RCOfferings | null>(null);
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
          console.warn("[Purchases] No RevenueCat API key — skipping init");
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

        const [customerInfo, offeringsData] = await Promise.all([
          PurchasesSDK!.getCustomerInfo(),
          PurchasesSDK!.getOfferings().catch(() => null),
        ]);

        setActiveEntitlements(Object.keys(customerInfo?.entitlements?.active || {}));
        if (offeringsData) setOfferings(offeringsData);
      } catch (e) {
        console.warn("[Purchases] init error:", e);
      }
      setIsReady(true);
    }

    init();
  }, [user?.id]);

  const hasEntitlement = useCallback(
    (id: string) => activeEntitlements.includes(id),
    [activeEntitlements]
  );

  const getPriceString = useCallback(
    (productId: string): string | null => {
      if (!offerings?.current) return null;
      const allPkgs = offerings.current.availablePackages;
      const pkg = allPkgs.find((p) => p.product?.identifier === productId);
      return pkg?.product?.priceString ?? null;
    },
    [offerings]
  );

  const refreshEntitlements = useCallback(async () => {
    if (!PurchasesSDK || Platform.OS === "web") return;
    try {
      const customerInfo = await PurchasesSDK.getCustomerInfo();
      setActiveEntitlements(Object.keys(customerInfo?.entitlements?.active || {}));
    } catch {}
  }, []);

  const purchasePackage = useCallback(async (productId: string, crewId?: string): Promise<boolean> => {
    if (!PurchasesSDK || Platform.OS === "web") return false;
    const apiKey = getApiKey();
    if (!apiKey) return false;
    try {
      if (crewId) {
        await PurchasesSDK.logIn(`crew_${crewId}`);
      }
      const latestOfferings = await PurchasesSDK.getOfferings();
      const current = latestOfferings?.current;
      if (!current) return false;
      const pkg = current.availablePackages?.find(
        (p: RCPackage) => p.product?.identifier === productId
      );
      if (!pkg) return false;
      const { customerInfo } = await PurchasesSDK.purchasePackage(pkg);
      const entitlements = Object.keys(customerInfo?.entitlements?.active || {});
      setActiveEntitlements(entitlements);
      if (latestOfferings) setOfferings(latestOfferings);
      if (crewId && user?.id) {
        await PurchasesSDK.logIn(user.id);
      }
      return true;
    } catch (e) {
      console.warn("[Purchases] purchase error:", e);
      if (crewId && user?.id) {
        try { await PurchasesSDK.logIn(user.id); } catch {}
      }
      return false;
    }
  }, [user?.id, configured]);

  const restorePurchases = useCallback(async () => {
    if (!PurchasesSDK || Platform.OS === "web") {
      throw new Error("Purchases are not supported on this platform");
    }
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("RevenueCat is not configured");
    }
    const customerInfo = await PurchasesSDK.restorePurchases();
    setActiveEntitlements(Object.keys(customerInfo?.entitlements?.active || {}));
  }, []);

  const value = useMemo(
    () => ({ isReady, activeEntitlements, offerings, hasEntitlement, getPriceString, purchasePackage, restorePurchases, refreshEntitlements }),
    [isReady, activeEntitlements, offerings, hasEntitlement, getPriceString, purchasePackage, restorePurchases, refreshEntitlements]
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
