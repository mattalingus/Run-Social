import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listAppPublicApiKeys,
  listProducts,
  createProduct,
  listEntitlements,
  createEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  type App,
  type Product,
  type Project,
  type Entitlement,
  type Offering,
  type Package,
  type CreateProductData,
} from "replit-revenuecat-v2";

const PROJECT_NAME = "PaceUp";
const APP_STORE_APP_NAME = "PaceUp iOS";
const APP_STORE_BUNDLE_ID = "com.paceup";
const PLAY_STORE_APP_NAME = "PaceUp Android";
const PLAY_STORE_PACKAGE_NAME = "com.paceup";

const OFFERING_IDENTIFIER = "crew_subscriptions";
const OFFERING_DISPLAY_NAME = "Crew Subscriptions";

const PRODUCTS = [
  {
    identifier: "crew_growth_monthly",
    playStoreIdentifier: "crew_growth_monthly:monthly",
    displayName: "Crew Growth Monthly",
    title: "Crew Growth",
    duration: "P1M" as const,
    priceUsd: 1990000,
    entitlementId: "crew_growth",
    entitlementName: "Crew Growth",
    packageId: "$rc_monthly",
    packageName: "Crew Growth Monthly",
  },
  {
    identifier: "crew_discovery_boost_monthly",
    playStoreIdentifier: "crew_discovery_boost_monthly:monthly",
    displayName: "Crew Discovery Boost Monthly",
    title: "Crew Discovery Boost",
    duration: "P1M" as const,
    priceUsd: 4990000,
    entitlementId: "crew_discovery_boost",
    entitlementName: "Crew Discovery Boost",
    packageId: "crew_discovery_boost_monthly",
    packageName: "Crew Discovery Boost Monthly",
  },
];

type TestStorePricesResponse = {
  object: string;
  prices: { amount_micros: number; currency: string }[];
};

async function seedRevenueCat() {
  const client = await getUncachableRevenueCatClient();

  let project: Project;
  const { data: existingProjects, error: listProjectsError } = await listProjects({
    client,
    query: { limit: 20 },
  });
  if (listProjectsError) throw new Error("Failed to list projects");

  const existingProject = existingProjects.items?.find((p) => p.name === PROJECT_NAME);
  if (existingProject) {
    console.log("Project already exists:", existingProject.id);
    project = existingProject;
  } else {
    const { data: newProject, error } = await createProject({ client, body: { name: PROJECT_NAME } });
    if (error) throw new Error("Failed to create project");
    console.log("Created project:", newProject.id);
    project = newProject;
  }

  const { data: apps, error: listAppsError } = await listApps({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listAppsError || !apps || apps.items.length === 0) throw new Error("No apps found");

  let testStoreApp: App | undefined = apps.items.find((a) => a.type === "test_store");
  let appStoreApp: App | undefined = apps.items.find((a) => a.type === "app_store");
  let playStoreApp: App | undefined = apps.items.find((a) => a.type === "play_store");

  if (!testStoreApp) throw new Error("No test store app found");
  console.log("Test store app:", testStoreApp.id);

  if (!appStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: { name: APP_STORE_APP_NAME, type: "app_store", app_store: { bundle_id: APP_STORE_BUNDLE_ID } },
    });
    if (error) throw new Error("Failed to create App Store app: " + JSON.stringify(error));
    appStoreApp = newApp;
    console.log("Created App Store app:", appStoreApp.id);
  } else {
    console.log("App Store app found:", appStoreApp.id);
  }

  if (!playStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: { name: PLAY_STORE_APP_NAME, type: "play_store", play_store: { package_name: PLAY_STORE_PACKAGE_NAME } },
    });
    if (error) throw new Error("Failed to create Play Store app: " + JSON.stringify(error));
    playStoreApp = newApp;
    console.log("Created Play Store app:", playStoreApp.id);
  } else {
    console.log("Play Store app found:", playStoreApp.id);
  }

  const { data: existingProducts, error: listProductsError } = await listProducts({
    client,
    path: { project_id: project.id },
    query: { limit: 100 },
  });
  if (listProductsError) throw new Error("Failed to list products");

  const ensureProduct = async (
    targetApp: App,
    label: string,
    storeIdentifier: string,
    meta: (typeof PRODUCTS)[0],
    isTestStore: boolean
  ): Promise<Product> => {
    const existing = existingProducts.items?.find(
      (p) => p.store_identifier === storeIdentifier && p.app_id === targetApp.id
    );
    if (existing) {
      console.log(`${label} product already exists:`, existing.id);
      return existing;
    }
    const body: CreateProductData["body"] = {
      store_identifier: storeIdentifier,
      app_id: targetApp.id,
      type: "subscription",
      display_name: meta.displayName,
    };
    if (isTestStore) {
      body.subscription = { duration: meta.duration };
      body.title = meta.title;
    }
    const { data: created, error } = await createProduct({ client, path: { project_id: project.id }, body });
    if (error) throw new Error(`Failed to create ${label} product: ${JSON.stringify(error)}`);
    console.log(`Created ${label} product:`, created.id);
    return created;
  };

  const productMap: Record<string, { test: Product; appStore: Product; playStore: Product }> = {};

  for (const meta of PRODUCTS) {
    const testProd = await ensureProduct(testStoreApp, `[${meta.identifier}] Test`, meta.identifier, meta, true);
    const appProd = await ensureProduct(appStoreApp, `[${meta.identifier}] AppStore`, meta.identifier, meta, false);
    const playProd = await ensureProduct(playStoreApp, `[${meta.identifier}] PlayStore`, meta.playStoreIdentifier, meta, false);
    productMap[meta.identifier] = { test: testProd, appStore: appProd, playStore: playProd };

    const { data: _priceData, error: priceError } = await client.post<TestStorePricesResponse>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: testProd.id },
      body: { prices: [{ amount_micros: meta.priceUsd, currency: "USD" }] },
    });
    if (priceError) {
      if (
        priceError &&
        typeof priceError === "object" &&
        "type" in priceError &&
        (priceError as any)["type"] === "resource_already_exists"
      ) {
        console.log(`Test store prices already exist for ${meta.identifier}`);
      } else {
        console.warn(`Warning: could not add test store prices for ${meta.identifier}:`, JSON.stringify(priceError));
      }
    } else {
      console.log(`Added test store prices for ${meta.identifier}`);
    }
  }

  const { data: existingEntitlements, error: listEntitlementsError } = await listEntitlements({
    client,
    path: { project_id: project.id },
    query: { limit: 50 },
  });
  if (listEntitlementsError) throw new Error("Failed to list entitlements");

  for (const meta of PRODUCTS) {
    const prods = productMap[meta.identifier];
    let ent: Entitlement | undefined = existingEntitlements.items?.find((e) => e.lookup_key === meta.entitlementId);
    if (ent) {
      console.log(`Entitlement [${meta.entitlementId}] already exists:`, ent.id);
    } else {
      const { data: newEnt, error } = await createEntitlement({
        client,
        path: { project_id: project.id },
        body: { lookup_key: meta.entitlementId, display_name: meta.entitlementName },
      });
      if (error) throw new Error(`Failed to create entitlement ${meta.entitlementId}: ${JSON.stringify(error)}`);
      console.log(`Created entitlement [${meta.entitlementId}]:`, newEnt.id);
      ent = newEnt;
    }

    const { error: attachError } = await attachProductsToEntitlement({
      client,
      path: { project_id: project.id, entitlement_id: ent.id },
      body: { product_ids: [prods.test.id, prods.appStore.id, prods.playStore.id] },
    });
    if (attachError) {
      if ((attachError as any).type === "unprocessable_entity_error") {
        console.log(`Products already attached to entitlement [${meta.entitlementId}]`);
      } else {
        throw new Error(`Failed to attach products to entitlement ${meta.entitlementId}: ${JSON.stringify(attachError)}`);
      }
    } else {
      console.log(`Attached products to entitlement [${meta.entitlementId}]`);
    }
  }

  const { data: existingOfferings, error: listOfferingsError } = await listOfferings({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listOfferingsError) throw new Error("Failed to list offerings");

  let offering: Offering | undefined = existingOfferings.items?.find((o) => o.lookup_key === OFFERING_IDENTIFIER);
  if (offering) {
    console.log("Offering already exists:", offering.id);
  } else {
    const { data: newOffering, error } = await createOffering({
      client,
      path: { project_id: project.id },
      body: { lookup_key: OFFERING_IDENTIFIER, display_name: OFFERING_DISPLAY_NAME },
    });
    if (error) throw new Error("Failed to create offering: " + JSON.stringify(error));
    console.log("Created offering:", newOffering.id);
    offering = newOffering;
  }

  if (!offering.is_current) {
    const { error } = await updateOffering({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      body: { is_current: true },
    });
    if (error) throw new Error("Failed to set offering as current: " + JSON.stringify(error));
    console.log("Set offering as current");
  }

  const { data: existingPackages, error: listPackagesError } = await listPackages({
    client,
    path: { project_id: project.id, offering_id: offering.id },
    query: { limit: 20 },
  });
  if (listPackagesError) throw new Error("Failed to list packages");

  for (const meta of PRODUCTS) {
    const prods = productMap[meta.identifier];
    let pkg: Package | undefined = existingPackages.items?.find((p) => p.lookup_key === meta.packageId);
    if (pkg) {
      console.log(`Package [${meta.packageId}] already exists:`, pkg.id);
    } else {
      const { data: newPkg, error } = await createPackages({
        client,
        path: { project_id: project.id, offering_id: offering.id },
        body: { lookup_key: meta.packageId, display_name: meta.packageName },
      });
      if (error) throw new Error(`Failed to create package ${meta.packageId}: ${JSON.stringify(error)}`);
      console.log(`Created package [${meta.packageId}]:`, newPkg.id);
      pkg = newPkg;
    }

    const { error: attachPkgError } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: {
        products: [
          { product_id: prods.test.id, eligibility_criteria: "all" },
          { product_id: prods.appStore.id, eligibility_criteria: "all" },
          { product_id: prods.playStore.id, eligibility_criteria: "all" },
        ],
      },
    });
    if (attachPkgError) {
      if (
        (attachPkgError as any).type === "unprocessable_entity_error" &&
        (attachPkgError as any).message?.includes("Cannot attach product")
      ) {
        console.log(`Skipping package attach for [${meta.packageId}]: already has incompatible product`);
      } else {
        throw new Error(`Failed to attach products to package ${meta.packageId}: ${JSON.stringify(attachPkgError)}`);
      }
    } else {
      console.log(`Attached products to package [${meta.packageId}]`);
    }
  }

  const { data: testKeys } = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: testStoreApp.id } });
  const { data: appStoreKeys } = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: appStoreApp.id } });
  const { data: playStoreKeys } = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: playStoreApp.id } });

  console.log("\n====================");
  console.log("PaceUp RevenueCat setup complete!");
  console.log("Project ID:", project.id);
  console.log("Test Store App ID:", testStoreApp.id);
  console.log("App Store App ID:", appStoreApp.id);
  console.log("Play Store App ID:", playStoreApp.id);
  console.log("REVENUECAT_PROJECT_ID=" + project.id);
  console.log("REVENUECAT_TEST_STORE_APP_ID=" + testStoreApp.id);
  console.log("REVENUECAT_APPLE_APP_STORE_APP_ID=" + appStoreApp.id);
  console.log("REVENUECAT_GOOGLE_PLAY_STORE_APP_ID=" + playStoreApp.id);
  console.log("EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=" + (testKeys?.items?.map((k) => k.key).join(", ") ?? "N/A"));
  console.log("EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=" + (appStoreKeys?.items?.map((k) => k.key).join(", ") ?? "N/A"));
  console.log("EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=" + (playStoreKeys?.items?.map((k) => k.key).join(", ") ?? "N/A"));
  console.log("====================\n");
}

seedRevenueCat().catch(console.error);
