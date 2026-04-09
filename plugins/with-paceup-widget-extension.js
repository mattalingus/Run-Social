/**
 * plugins/with-paceup-widget-extension.js
 *
 * Creates ONE Xcode extension target (PaceUpWidgetExtension) that supports:
 *   - Home Screen Widgets (WidgetKit, small + medium)
 *   - Live Activities / Dynamic Island (ActivityKit)
 *
 * Also adds the missing HealthKit access entitlement to the main app.
 *
 * Architectural rules followed:
 *   - addTarget("app_extension") is called ONCE; productType is immediately
 *     overridden to com.apple.product-type.widgetkit-extension
 *   - The auto-created "Copy Files" phase (dstSubfolderSpec=13) is used as-is;
 *     only RemoveHeadersOnCopy is stamped on it
 *   - No second "Embed App Extensions" phase is created
 *   - No manual PBXTargetDependency entries are created
 */

const {
  withEntitlementsPlist,
  withXcodeProject,
  withDangerousMod,
} = require("./_resolve-config-plugins");
const path = require("path");
const fs = require("fs");

const EXTENSION_NAME = "PaceUpWidgetExtension";
const EXTENSION_BUNDLE_ID = "com.paceup.PaceUpWidget";
const APP_GROUP = "group.com.paceup.app";

// ─── ObjC/Swift bridge files (written to ios/ → added to main app target) ────

const ACTIVITY_BRIDGE_M = `\
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PaceUpActivityBridge, NSObject)

RCT_EXTERN_METHOD(startActivity:(NSDictionary *)data
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateActivity:(NSDictionary *)data
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(endActivity:(NSDictionary *)data
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
`;

const ACTIVITY_BRIDGE_SWIFT = `\
import Foundation
import ActivityKit

// NOTE: Must match PaceUpAttributes.swift in the extension exactly.
@available(iOS 16.2, *)
struct PaceUpLiveActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var elapsedSeconds: Int
    var distanceMiles: Double
    var paceMinPerMile: Double
    var activityType: String
  }
  var activityName: String
}

private var _activityStorage: Any? = nil

@available(iOS 16.2, *)
private var _currentActivity: Activity<PaceUpLiveActivityAttributes>? {
  get { _activityStorage as? Activity<PaceUpLiveActivityAttributes> }
  set { _activityStorage = newValue }
}

@objc(PaceUpActivityBridge)
class PaceUpActivityBridge: NSObject {

  @objc func startActivity(
    _ data: NSDictionary,
    resolver resolve: @escaping (Any?) -> Void,
    rejecter _: @escaping (String, String, Error?) -> Void
  ) {
    guard #available(iOS 16.2, *) else { resolve(nil); return }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { resolve(nil); return }
    let t = data["activityType"] as? String ?? "run"
    let n = t == "ride" ? "Ride" : t == "walk" ? "Walk" : "Run"
    let attrs = PaceUpLiveActivityAttributes(activityName: n)
    let state = PaceUpLiveActivityAttributes.ContentState(
      elapsedSeconds: data["elapsedSeconds"] as? Int ?? 0,
      distanceMiles: data["distanceMiles"] as? Double ?? 0.0,
      paceMinPerMile: data["paceMinPerMile"] as? Double ?? 0.0,
      activityType: t
    )
    do {
      _currentActivity = try Activity.request(
        attributes: attrs, contentState: state, pushType: nil
      )
      resolve(_currentActivity?.id)
    } catch {
      resolve(nil)
    }
  }

  @objc func updateActivity(
    _ data: NSDictionary,
    resolver resolve: @escaping (Any?) -> Void,
    rejecter _: @escaping (String, String, Error?) -> Void
  ) {
    guard #available(iOS 16.2, *) else { resolve(nil); return }
    guard let activity = _currentActivity else { resolve(nil); return }
    let t = data["activityType"] as? String ?? "run"
    let state = PaceUpLiveActivityAttributes.ContentState(
      elapsedSeconds: data["elapsedSeconds"] as? Int ?? 0,
      distanceMiles: data["distanceMiles"] as? Double ?? 0.0,
      paceMinPerMile: data["paceMinPerMile"] as? Double ?? 0.0,
      activityType: t
    )
    Task { await activity.update(using: state); resolve(nil) }
  }

  @objc func endActivity(
    _ data: NSDictionary,
    resolver resolve: @escaping (Any?) -> Void,
    rejecter _: @escaping (String, String, Error?) -> Void
  ) {
    guard #available(iOS 16.2, *) else { resolve(nil); return }
    guard let activity = _currentActivity else { resolve(nil); return }
    let t = data["activityType"] as? String ?? "run"
    let state = PaceUpLiveActivityAttributes.ContentState(
      elapsedSeconds: data["elapsedSeconds"] as? Int ?? 0,
      distanceMiles: data["distanceMiles"] as? Double ?? 0.0,
      paceMinPerMile: data["paceMinPerMile"] as? Double ?? 0.0,
      activityType: t
    )
    Task {
      await activity.end(using: state, dismissalPolicy: .after(.now + 30))
      _currentActivity = nil
      resolve(nil)
    }
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }
}
`;

const WIDGET_BRIDGE_M = `\
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PaceUpWidgetBridge, NSObject)

RCT_EXTERN_METHOD(writeWidgetJson:(NSString *)jsonString
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
`;

const WIDGET_BRIDGE_SWIFT = `\
import Foundation
import WidgetKit

@objc(PaceUpWidgetBridge)
class PaceUpWidgetBridge: NSObject {

  @objc func writeWidgetJson(
    _ jsonString: String,
    resolver resolve: @escaping (Any?) -> Void,
    rejecter reject: @escaping (String, String, Error?) -> Void
  ) {
    guard
      let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: "${APP_GROUP}"
      )
    else {
      reject("NO_APP_GROUP", "App Group not available", nil)
      return
    }
    let fileURL = containerURL.appendingPathComponent("widget_data.json")
    guard let data = jsonString.data(using: .utf8) else {
      reject("ENCODE_ERR", "Could not encode JSON string", nil)
      return
    }
    do {
      try data.write(to: fileURL, options: .atomicWrite)
      WidgetCenter.shared.reloadAllTimelines()
      resolve(nil)
    } catch {
      reject("WRITE_ERR", error.localizedDescription, error)
    }
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }
}
`;

// ─── Extension Swift files (written to ios/PaceUpWidgetExtension/) ────────────

// PaceUpAttributes.swift — ActivityAttributes shared between extension files
const ATTRIBUTES_SWIFT = `\
import ActivityKit

struct PaceUpLiveActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var elapsedSeconds: Int
    var distanceMiles: Double
    var paceMinPerMile: Double
    var activityType: String
  }
  var activityName: String
}
`;

// PaceUpLiveActivity.swift — Dynamic Island + Lock Screen Live Activity widget
const LIVE_ACTIVITY_SWIFT = `\
import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Helpers

private func actIcon(_ name: String) -> String {
  switch name.lowercased() {
  case "ride": return "bicycle"
  case "walk": return "figure.walk"
  default:     return "figure.run"
  }
}

private func fmtTime(_ s: Int) -> String {
  let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
  if h > 0 { return String(format: "%d:%02d:%02d", h, m, sec) }
  return String(format: "%02d:%02d", m, sec)
}

private func fmtDist(_ mi: Double) -> String { String(format: "%.2f", mi) }

private func fmtPace(_ p: Double) -> String {
  guard p > 0 else { return "--:--" }
  let m = Int(p), s = Int((p - Double(m)) * 60)
  return String(format: "%d:%02d", m, s)
}

private let kGreen = Color(red: 0, green: 0.851, blue: 0.494)
private let kBg    = Color(red: 5 / 255, green: 12 / 255, blue: 9 / 255)

// MARK: - Lock Screen / Notification Banner View

struct PaceUpLockScreenView: View {
  let ctx: ActivityViewContext<PaceUpLiveActivityAttributes>

  var body: some View {
    HStack(spacing: 16) {
      Image(systemName: actIcon(ctx.attributes.activityName))
        .font(.system(size: 22, weight: .semibold))
        .foregroundColor(kGreen)

      VStack(alignment: .leading, spacing: 2) {
        Text(ctx.attributes.activityName)
          .font(.system(size: 11, weight: .medium))
          .foregroundColor(.gray)
        Text(fmtTime(ctx.state.elapsedSeconds))
          .font(.system(size: 22, weight: .bold, design: .monospaced))
          .foregroundColor(.white)
      }

      Spacer()

      VStack(alignment: .trailing, spacing: 2) {
        Text(fmtDist(ctx.state.distanceMiles) + " mi")
          .font(.system(size: 16, weight: .semibold))
          .foregroundColor(.white)
        Text(fmtPace(ctx.state.paceMinPerMile) + " /mi")
          .font(.system(size: 12, weight: .medium))
          .foregroundColor(.gray)
      }
    }
    .padding(16)
  }
}

// MARK: - Live Activity Widget

struct PaceUpLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PaceUpLiveActivityAttributes.self) { ctx in
      PaceUpLockScreenView(ctx: ctx)
        .activityBackgroundTint(kBg)
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { ctx in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label {
            Text(fmtDist(ctx.state.distanceMiles) + " mi")
              .font(.system(size: 15, weight: .semibold))
              .foregroundColor(.white)
          } icon: {
            Image(systemName: actIcon(ctx.attributes.activityName))
              .foregroundColor(kGreen)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          Label {
            Text(fmtPace(ctx.state.paceMinPerMile) + "/mi")
              .font(.system(size: 15, weight: .semibold))
              .foregroundColor(.white)
          } icon: {
            Image(systemName: "speedometer")
              .foregroundColor(kGreen)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack {
            Spacer()
            Text(fmtTime(ctx.state.elapsedSeconds))
              .font(.system(size: 20, weight: .bold, design: .monospaced))
              .foregroundColor(.white)
            Spacer()
          }
        }
      } compactLeading: {
        Image(systemName: actIcon(ctx.attributes.activityName))
          .foregroundColor(kGreen)
      } compactTrailing: {
        Text(fmtDist(ctx.state.distanceMiles))
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(.white)
      } minimal: {
        Image(systemName: "figure.run")
          .foregroundColor(kGreen)
      }
      .widgetURL(URL(string: "paceup://live"))
      .keylineTint(kGreen)
    }
  }
}
`;

// PaceUpWidget.swift — Home Screen widget (small + medium) + @main WidgetBundle
const WIDGET_SWIFT = `\
import SwiftUI
import WidgetKit

private let kAppGroup = "${APP_GROUP}"
private let kDataFile = "widget_data.json"

private let kGreenW = Color(red: 0, green: 0.851, blue: 0.494)
private let kBgW    = Color(red: 5 / 255, green: 12 / 255, blue: 9 / 255)

// MARK: - Data model

struct WidgetPayload: Codable {
  var nextRunTitle: String
  var nextRunTimestamp: Double
  var distanceRangeMiles: String
  var weeklyMiles: Double
  var monthlyGoal: Double
}

// MARK: - Timeline entry

struct PaceUpWidgetEntry: TimelineEntry {
  let date: Date
  let payload: WidgetPayload
}

// MARK: - Provider

struct PaceUpWidgetProvider: TimelineProvider {

  func placeholder(in _: Context) -> PaceUpWidgetEntry {
    PaceUpWidgetEntry(
      date: Date(),
      payload: WidgetPayload(
        nextRunTitle: "Morning Run",
        nextRunTimestamp: Date().addingTimeInterval(3600).timeIntervalSince1970,
        distanceRangeMiles: "3-5",
        weeklyMiles: 12.4,
        monthlyGoal: 50
      )
    )
  }

  func getSnapshot(in _: Context, completion: @escaping (PaceUpWidgetEntry) -> Void) {
    completion(makeEntry())
  }

  func getTimeline(in _: Context, completion: @escaping (Timeline<PaceUpWidgetEntry>) -> Void) {
    let e = makeEntry()
    let refresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
    completion(Timeline(entries: [e], policy: .after(refresh)))
  }

  private func makeEntry() -> PaceUpWidgetEntry {
    var payload = WidgetPayload(
      nextRunTitle: "",
      nextRunTimestamp: 0,
      distanceRangeMiles: "",
      weeklyMiles: 0,
      monthlyGoal: 0
    )
    if let containerURL = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: kAppGroup
    ),
      let data = try? Data(contentsOf: containerURL.appendingPathComponent(kDataFile)),
      let decoded = try? JSONDecoder().decode(WidgetPayload.self, from: data)
    {
      payload = decoded
    }
    return PaceUpWidgetEntry(date: Date(), payload: payload)
  }
}

// MARK: - Helpers

private func timeUntilLabel(timestamp: Double) -> String {
  guard timestamp > 0 else { return "" }
  let seconds = timestamp - Date().timeIntervalSince1970
  guard seconds > 0 else { return "Starting soon" }
  let hours = Int(seconds) / 3600
  let minutes = (Int(seconds) % 3600) / 60
  if hours >= 24 { return "in \\(hours / 24)d" }
  if hours >= 1  { return "in \\(hours)h \\(minutes)m" }
  if minutes >= 1 { return "in \\(minutes)m" }
  return "Starting soon"
}

// MARK: - Small widget view

struct PaceUpSmallView: View {
  let e: PaceUpWidgetEntry
  var body: some View {
    ZStack(alignment: .topLeading) {
      kBgW
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 4) {
          Image(systemName: "figure.run")
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(kGreenW)
          Text("PaceUp")
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(kGreenW)
        }
        Spacer()
        if e.payload.nextRunTitle.isEmpty {
          Text("No runs scheduled")
            .font(.system(size: 13, weight: .medium))
            .foregroundColor(.gray)
        } else {
          Text("NEXT RUN")
            .font(.system(size: 9, weight: .semibold))
            .foregroundColor(.gray)
          Text(e.payload.nextRunTitle)
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(.white)
            .lineLimit(2)
          let until = timeUntilLabel(timestamp: e.payload.nextRunTimestamp)
          if !until.isEmpty {
            Text(until)
              .font(.system(size: 12, weight: .semibold))
              .foregroundColor(kGreenW)
          }
          if !e.payload.distanceRangeMiles.isEmpty {
            Text("\\(e.payload.distanceRangeMiles) mi")
              .font(.system(size: 11))
              .foregroundColor(.gray)
          }
        }
      }
      .padding(12)
    }
    .widgetURL(URL(string: "paceup://discover")!)
  }
}

// MARK: - Medium widget view

struct PaceUpMediumView: View {
  let e: PaceUpWidgetEntry
  var body: some View {
    ZStack {
      kBgW
      HStack(spacing: 16) {
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 4) {
            Image(systemName: "figure.run")
              .font(.system(size: 12, weight: .semibold))
              .foregroundColor(kGreenW)
            Text("PaceUp")
              .font(.system(size: 11, weight: .bold))
              .foregroundColor(kGreenW)
          }
          Spacer()
          if e.payload.nextRunTitle.isEmpty {
            Text("No upcoming runs")
              .font(.system(size: 12))
              .foregroundColor(.gray)
          } else {
            Text("NEXT RUN")
              .font(.system(size: 9, weight: .semibold))
              .foregroundColor(.gray)
            Text(e.payload.nextRunTitle)
              .font(.system(size: 13, weight: .bold))
              .foregroundColor(.white)
              .lineLimit(2)
            let until = timeUntilLabel(timestamp: e.payload.nextRunTimestamp)
            if !until.isEmpty {
              Text(until)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(kGreenW)
            }
            if !e.payload.distanceRangeMiles.isEmpty {
              Text("\\(e.payload.distanceRangeMiles) mi")
                .font(.system(size: 11))
                .foregroundColor(.gray)
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        Rectangle().fill(Color.white.opacity(0.12)).frame(width: 1)

        VStack(alignment: .leading, spacing: 4) {
          Text("THIS WEEK")
            .font(.system(size: 9, weight: .semibold))
            .foregroundColor(.gray)
          Text(String(format: "%.1f mi", e.payload.weeklyMiles))
            .font(.system(size: 20, weight: .bold))
            .foregroundColor(.white)
          if e.payload.monthlyGoal > 0 {
            let weeklyGoal = e.payload.monthlyGoal / 4
            let pct = min(e.payload.weeklyMiles / weeklyGoal, 1.0)
            Text(String(format: "%.0f%% of %.0f mi/wk", pct * 100, weeklyGoal))
              .font(.system(size: 10))
              .foregroundColor(.gray)
            GeometryReader { g in
              ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.15)).frame(height: 4)
                Capsule().fill(kGreenW).frame(width: g.size.width * pct, height: 4)
              }
            }
            .frame(height: 4)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(14)
    }
    .widgetURL(URL(string: "paceup://discover")!)
  }
}

// MARK: - Entry view dispatcher

struct PaceUpWidgetEntryView: View {
  @Environment(\\.widgetFamily) var family
  let entry: PaceUpWidgetEntry
  var body: some View {
    if family == .systemMedium {
      PaceUpMediumView(e: entry)
    } else {
      PaceUpSmallView(e: entry)
    }
  }
}

// MARK: - Home Screen Widget

struct PaceUpWidget: Widget {
  let kind = "PaceUpWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: PaceUpWidgetProvider()) { entry in
      if #available(iOS 17.0, *) {
        PaceUpWidgetEntryView(entry: entry)
          .containerBackground(kBgW, for: .widget)
      } else {
        PaceUpWidgetEntryView(entry: entry)
      }
    }
    .configurationDisplayName("PaceUp")
    .description("Your next run and weekly progress.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

// MARK: - Widget Bundle (entry point for the extension)

@main
struct PaceUpWidgetBundle: WidgetBundle {
  var body: some Widget {
    PaceUpWidget()
    PaceUpLiveActivityWidget()
  }
}
`;

// ─── Extension support files ──────────────────────────────────────────────────

const EXTENSION_INFO_PLIST = `\
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundleDisplayName</key>
    <string>PaceUp Widget</string>
    <key>CFBundleVersion</key>
    <string>$(CURRENT_PROJECT_VERSION)</string>
    <key>CFBundleShortVersionString</key>
    <string>$(MARKETING_VERSION)</string>
    <key>CFBundlePackageType</key>
    <string>XPC!</string>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.widgetkit-extension</string>
    </dict>
</dict>
</plist>
`;

const EXTENSION_ENTITLEMENTS = `\
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>${APP_GROUP}</string>
    </array>
</dict>
</plist>
`;

// ─── Plugin ───────────────────────────────────────────────────────────────────

function withPaceUpWidgetExtension(config) {

  // 1. Add missing HealthKit access entitlement to main app
  config = withEntitlementsPlist(config, (cfg) => {
    if (!Array.isArray(cfg.modResults["com.apple.developer.healthkit.access"])) {
      cfg.modResults["com.apple.developer.healthkit.access"] = ["workout-processing"];
    }
    return cfg;
  });

  // 2. Write all native source files into ios/
  config = withDangerousMod(config, [
    "ios",
    (cfg) => {
      const iosRoot = cfg.modRequest.platformProjectRoot;

      // Bridge files → main app target
      fs.writeFileSync(path.join(iosRoot, "PaceUpActivityBridge.m"), ACTIVITY_BRIDGE_M, "utf8");
      fs.writeFileSync(path.join(iosRoot, "PaceUpActivityBridge.swift"), ACTIVITY_BRIDGE_SWIFT, "utf8");
      fs.writeFileSync(path.join(iosRoot, "PaceUpWidgetBridge.m"), WIDGET_BRIDGE_M, "utf8");
      fs.writeFileSync(path.join(iosRoot, "PaceUpWidgetBridge.swift"), WIDGET_BRIDGE_SWIFT, "utf8");

      // Extension directory + files
      const extDir = path.join(iosRoot, EXTENSION_NAME);
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(path.join(extDir, "PaceUpAttributes.swift"), ATTRIBUTES_SWIFT, "utf8");
      fs.writeFileSync(path.join(extDir, "PaceUpLiveActivity.swift"), LIVE_ACTIVITY_SWIFT, "utf8");
      fs.writeFileSync(path.join(extDir, "PaceUpWidget.swift"), WIDGET_SWIFT, "utf8");
      fs.writeFileSync(path.join(extDir, "Info.plist"), EXTENSION_INFO_PLIST, "utf8");
      fs.writeFileSync(
        path.join(extDir, `${EXTENSION_NAME}.entitlements`),
        EXTENSION_ENTITLEMENTS,
        "utf8"
      );

      return cfg;
    },
  ]);

  // 3. Xcode project: add ONE extension target + configure everything
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;

    // Idempotency: skip if target already exists
    const nativeTargets = project.hash.project.objects["PBXNativeTarget"] || {};
    const alreadyAdded = Object.entries(nativeTargets).some(
      ([key, val]) => !key.endsWith("_comment") && val.name === `"${EXTENSION_NAME}"`
    );
    if (alreadyAdded) return cfg;

    const mainTargetInfo = project.getFirstTarget();
    const mainTargetUUID = mainTargetInfo.uuid;

    // ── Create extension target ──────────────────────────────────────────────
    // addTarget("app_extension") creates:
    //   • PBXNativeTarget with productType app-extension
    //   • "Copy Files" build phase (dstSubfolderSpec=13) in the main target
    //   • PBXTargetDependency from main → extension
    // NOTE: we do NOT override productType to widgetkit-extension — the xcode
    // npm library cannot reliably serialize that value. The extension is
    // declared as WidgetKit via NSExtensionPointIdentifier in Info.plist.
    const extTarget = project.addTarget(
      EXTENSION_NAME,
      "app_extension",
      EXTENSION_NAME,
      EXTENSION_BUNDLE_ID
    );

    const ntSection = project.hash.project.objects["PBXNativeTarget"];

    // ── Stamp RemoveHeadersOnCopy on the auto-created Copy Files phase ───────
    {
      const mainPbxTarget = ntSection[mainTargetUUID];
      const copyFilesSection =
        project.hash.project.objects["PBXCopyFilesBuildPhase"] || {};
      const buildFilesSection =
        project.hash.project.objects["PBXBuildFile"] || {};

      for (const phaseRef of mainPbxTarget?.buildPhases || []) {
        const phase = copyFilesSection[phaseRef.value];
        if (phase && phase.dstSubfolderSpec === "13") {
          for (const fileRef of phase.files || []) {
            const bf = buildFilesSection[fileRef.value];
            if (bf && !bf.settings?.ATTRIBUTES) {
              bf.settings = bf.settings || {};
              bf.settings.ATTRIBUTES = ["RemoveHeadersOnCopy"];
            }
          }
        }
      }
    }

    // ── Configure extension build settings ───────────────────────────────────
    const xcBuildCfg = project.hash.project.objects["XCBuildConfiguration"] || {};
    const cfgListSection = project.hash.project.objects["XCConfigurationList"] || {};
    const extCfgListUUID = ntSection[extTarget.uuid]?.buildConfigurationList;
    const extCfgList = cfgListSection[extCfgListUUID];

    if (extCfgList && extCfgList.buildConfigurations) {
      for (const ref of extCfgList.buildConfigurations) {
        const bc = xcBuildCfg[ref.value];
        if (!bc) continue;
        bc.buildSettings.PRODUCT_NAME = `"${EXTENSION_NAME}"`;
        bc.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${EXTENSION_BUNDLE_ID}"`;
        bc.buildSettings.WRAPPER_EXTENSION = "appex";
        bc.buildSettings.INFOPLIST_FILE = `"${EXTENSION_NAME}/Info.plist"`;
        bc.buildSettings.SWIFT_VERSION = "5.0";
        bc.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
        bc.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = "16.1";
        bc.buildSettings.APPLICATION_EXTENSION_API_ONLY = "YES";
        bc.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${EXTENSION_NAME}/${EXTENSION_NAME}.entitlements"`;
        bc.buildSettings.SKIP_INSTALL = "YES";
        bc.buildSettings.ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = "NO";
        bc.buildSettings.SDKROOT = "iphoneos";
        bc.buildSettings.PLATFORM_NAME = "iphoneos";
        bc.buildSettings.SUPPORTED_PLATFORMS = '"iphoneos iphonesimulator"';
        bc.buildSettings.SUPPORTS_MACCATALYST = "NO";
        bc.buildSettings.LD_RUNPATH_SEARCH_PATHS =
          '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"';
      }
    }

    // ── Add build phases to extension target ─────────────────────────────────
    project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", extTarget.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", extTarget.uuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", extTarget.uuid);

    // ── Create Xcode group for extension files ────────────────────────────────
    const extGroupResult = project.addPbxGroup([], EXTENSION_NAME, EXTENSION_NAME);
    const extGroupUUID = extGroupResult.uuid;

    const mainProjectInfo = project.getFirstProject();
    const mainGroupUUID = mainProjectInfo.firstProject.mainGroup;
    const pbxGroups = project.hash.project.objects["PBXGroup"] || {};

    if (pbxGroups[mainGroupUUID]) {
      pbxGroups[mainGroupUUID].children = pbxGroups[mainGroupUUID].children || [];
      pbxGroups[mainGroupUUID].children.push({
        value: extGroupUUID,
        comment: EXTENSION_NAME,
      });
    }

    // ── Add Swift source files → extension target ─────────────────────────────
    // Use bare filenames — the group already has path = EXTENSION_NAME so Xcode
    // resolves: ios/PaceUpWidgetExtension/<filename>. Prefixing with EXTENSION_NAME
    // would create a double-nested path and cause "Build input files cannot be found".
    project.addSourceFile(
      `PaceUpAttributes.swift`,
      { target: extTarget.uuid },
      extGroupUUID
    );
    project.addSourceFile(
      `PaceUpLiveActivity.swift`,
      { target: extTarget.uuid },
      extGroupUUID
    );
    project.addSourceFile(
      `PaceUpWidget.swift`,
      { target: extTarget.uuid },
      extGroupUUID
    );

    // ── Add bridge files → main app target ────────────────────────────────────
    project.addSourceFile(
      "PaceUpActivityBridge.m",
      { target: mainTargetUUID },
      mainGroupUUID
    );
    project.addSourceFile(
      "PaceUpActivityBridge.swift",
      { target: mainTargetUUID },
      mainGroupUUID
    );
    project.addSourceFile(
      "PaceUpWidgetBridge.m",
      { target: mainTargetUUID },
      mainGroupUUID
    );
    project.addSourceFile(
      "PaceUpWidgetBridge.swift",
      { target: mainTargetUUID },
      mainGroupUUID
    );

    return cfg;
  });

  return config;
}

module.exports = withPaceUpWidgetExtension;
