const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// ─── Stubs ────────────────────────────────────────────────────────────────────
const stubs = {
  "expo-sharing": path.resolve(__dirname, "stubs/expo-sharing.js"),
  "expo-media-library": path.resolve(__dirname, "stubs/expo-media-library.js"),
  "react-native-maps": path.resolve(__dirname, "stubs/react-native-maps.js"),
};

// ─── Resolve stubs + web-only overrides ──────────────────────────────────────
const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && stubs[moduleName]) {
    return { filePath: stubs[moduleName], type: "sourceFile" };
  }
  if (moduleName === "expo-sharing" || moduleName === "expo-media-library") {
    return { filePath: stubs[moduleName], type: "sourceFile" };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

// ─── Transpile packages that ship ESM/Flow source ────────────────────────────
config.transformer.transformIgnorePatterns = [
  "node_modules/(?!(react-native|@react-native|react-native-view-shot|@expo|expo|@unimodules|unimodules|@react-navigation|react-native-svg|react-native-reanimated|react-native-safe-area-context|react-native-screens|react-native-keyboard-controller|react-native-maps)/)",
];

module.exports = config;
