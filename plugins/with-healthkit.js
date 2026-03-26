const { withInfoPlist, withEntitlementsPlist } = require("@expo/config-plugins");

const SHARE_USAGE = "PaceUp uses Apple Health to import your runs, rides, and walks so all your activity appears in one place.";
const UPDATE_USAGE = "PaceUp saves completed workouts to Apple Health so they count toward your Activity rings.";

function withHealthKitPermissions(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSHealthShareUsageDescription = SHARE_USAGE;
    mod.modResults.NSHealthUpdateUsageDescription = UPDATE_USAGE;
    return mod;
  });

  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults["com.apple.developer.healthkit"] = true;
    mod.modResults["com.apple.developer.healthkit.background-delivery"] = true;
    if (!Array.isArray(mod.modResults["com.apple.developer.healthkit.access"])) {
      mod.modResults["com.apple.developer.healthkit.access"] = [];
    }
    return mod;
  });

  return config;
}

module.exports = withHealthKitPermissions;
