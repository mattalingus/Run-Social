/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "watch",
  name: "PaceUpWatch",
  displayName: "PaceUp",
  bundleIdentifier: "com.paceup.watchkitapp",
  deploymentTarget: "10.0",
  frameworks: [
    "SwiftUI",
    "HealthKit",
    "CoreLocation",
    "WatchConnectivity",
    "WatchKit",
  ],
  colors: {
    $accent: { color: "#00D97E", darkColor: "#00D97E" },
  },
  icon: "../../assets/images/icon.png",
  entitlements: {
    "com.apple.security.application-groups":
      config?.ios?.entitlements?.["com.apple.security.application-groups"] ?? [
        "group.com.paceup.app",
      ],
    "com.apple.developer.healthkit": true,
    "com.apple.developer.healthkit.access": [],
  },
  infoPlist: {
    WKApplication: true,
    WKCompanionAppBundleIdentifier: "com.paceup",
    WKRunsIndependentlyOfCompanionApp: true,
    WKBackgroundModes: ["workout-processing"],
    UIDeviceFamily: [4],
    // UIRequiredDeviceCapabilities is iOS-only — Apple rejects watchOS bundles
    // that include this key (ITMS-90595). Do NOT add it back.
    NSHealthShareUsageDescription:
      "PaceUp uses Apple Health to read your heart rate and workout data while you train.",
    NSHealthUpdateUsageDescription:
      "PaceUp saves completed workouts to Apple Health so they count toward your Activity rings.",
    NSLocationWhenInUseUsageDescription:
      "PaceUp uses your location to track your route, distance, and pace during workouts.",
    NSMotionUsageDescription:
      "PaceUp uses motion data to measure steps and cadence during workouts.",
  },
});
