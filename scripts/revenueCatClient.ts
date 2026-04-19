// Direct RevenueCat v2 API key auth (replaces Replit Connectors OAuth flow).
// NOTE: scripts/seedRevenueCat.ts still imports helpers from `replit-revenuecat-v2`
// and will break if run. It was a one-time seeding script — products are already
// configured in RevenueCat, so it should not need to run again.
// If ever needed, replace those imports with direct calls to https://api.revenuecat.com/v2.

export async function getUncachableRevenueCatClient() {
  const apiKey = process.env.REVENUECAT_API_KEY;
  if (!apiKey) {
    throw new Error("REVENUECAT_API_KEY not set");
  }
  return {
    baseUrl: "https://api.revenuecat.com/v2",
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}
