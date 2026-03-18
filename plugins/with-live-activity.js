/**
 * Expo config plugin: PaceUp Live Activity (Dynamic Island + Lock Screen)
 *
 * What this does:
 *  1. Adds NSSupportsLiveActivities = YES to the main app's Info.plist
 *  2. Writes PaceUpActivityBridge.m + PaceUpActivityBridge.swift to ios/
 *     (React Native native module that calls ActivityKit from JavaScript)
 *  3. Writes PaceUpLiveActivity/ Swift extension (WidgetKit extension with
 *     ActivityConfiguration for Dynamic Island and Lock Screen widgets)
 *  4. Adds both sets of files to the correct Xcode targets
 *  5. Writes the extension Info.plist and App Group entitlements file
 */

const {
  withInfoPlist,
  withXcodeProject,
  withDangerousMod,
} = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

const EXTENSION_NAME = "PaceUpLiveActivity";
const EXTENSION_BUNDLE_ID = "com.paceup.PaceUpLiveActivity";

// ─── Swift/ObjC source templates ─────────────────────────────────────────────

const BRIDGE_M = `\
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

const BRIDGE_SWIFT = `\
import Foundation
import ActivityKit

// PaceUpLiveActivityAttributes — must match the extension definition exactly.
// ActivityKit identifies activities by this type name + the app bundle ID at runtime.
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

// Type-erased storage avoids @available on the property itself.
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
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
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
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
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
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
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

const EXTENSION_SWIFT = `\
import ActivityKit
import SwiftUI
import WidgetKit

// Must match PaceUpActivityBridge.swift definition exactly.
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

// MARK: - Lock Screen / Banner View

@available(iOS 16.2, *)
struct PaceUpLockScreenView: View {
  let ctx: ActivityViewContext<PaceUpLiveActivityAttributes>

  var body: some View {
    HStack(spacing: 16) {
      Image(systemName: actIcon(ctx.attributes.activityName))
        .font(.system(size: 22, weight: .semibold))
        .foregroundColor(Color(red: 0, green: 0.851, blue: 0.494))

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

// MARK: - Widget

@available(iOS 16.2, *)
struct PaceUpLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PaceUpLiveActivityAttributes.self) { ctx in
      PaceUpLockScreenView(ctx: ctx)
        .activityBackgroundTint(Color(red: 5 / 255, green: 12 / 255, blue: 9 / 255))
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
              .foregroundColor(Color(red: 0, green: 0.851, blue: 0.494))
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          Label {
            Text(fmtPace(ctx.state.paceMinPerMile) + "/mi")
              .font(.system(size: 15, weight: .semibold))
              .foregroundColor(.white)
          } icon: {
            Image(systemName: "speedometer")
              .foregroundColor(Color(red: 0, green: 0.851, blue: 0.494))
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
          .foregroundColor(Color(red: 0, green: 0.851, blue: 0.494))
      } compactTrailing: {
        Text(fmtDist(ctx.state.distanceMiles))
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(.white)
      } minimal: {
        Image(systemName: "figure.run")
          .foregroundColor(Color(red: 0, green: 0.851, blue: 0.494))
      }
      .widgetURL(URL(string: "paceup://live"))
      .keylineTint(Color(red: 0, green: 0.851, blue: 0.494))
    }
  }
}

// MARK: - Entry Point

@available(iOS 16.2, *)
@main
struct PaceUpLiveActivityBundle: WidgetBundle {
  var body: some Widget {
    PaceUpLiveActivityWidget()
  }
}

// MARK: - Helpers

private func actIcon(_ name: String) -> String {
  switch name.lowercased() {
  case "ride": return "bicycle"
  case "walk": return "figure.walk"
  default: return "figure.run"
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
`;

const EXTENSION_INFO_PLIST = `\
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
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
        <string>group.com.paceup</string>
    </array>
</dict>
</plist>
`;

// ─── Plugin ──────────────────────────────────────────────────────────────────

function withLiveActivity(config) {
  // 1. Info.plist: advertise Live Activity support
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSSupportsLiveActivities = true;
    cfg.modResults.NSSupportsLiveActivitiesFrequentUpdates = true;
    return cfg;
  });

  // 2. Write native source files into ios/
  config = withDangerousMod(config, [
    "ios",
    (cfg) => {
      const iosRoot = cfg.modRequest.platformProjectRoot;

      // Bridge files → main app target
      fs.writeFileSync(
        path.join(iosRoot, "PaceUpActivityBridge.m"),
        BRIDGE_M,
        "utf8"
      );
      fs.writeFileSync(
        path.join(iosRoot, "PaceUpActivityBridge.swift"),
        BRIDGE_SWIFT,
        "utf8"
      );

      // Extension directory + files
      const extDir = path.join(iosRoot, EXTENSION_NAME);
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(
        path.join(extDir, "PaceUpLiveActivityWidget.swift"),
        EXTENSION_SWIFT,
        "utf8"
      );
      fs.writeFileSync(path.join(extDir, "Info.plist"), EXTENSION_INFO_PLIST, "utf8");
      fs.writeFileSync(
        path.join(extDir, `${EXTENSION_NAME}.entitlements`),
        EXTENSION_ENTITLEMENTS,
        "utf8"
      );

      return cfg;
    },
  ]);

  // 3. Xcode project: add targets and source files
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;

    // Idempotency: skip if extension target already exists
    const nativeTargets = project.hash.project.objects["PBXNativeTarget"] || {};
    const alreadyAdded = Object.entries(nativeTargets).some(
      ([key, val]) => !key.endsWith("_comment") && val.name === `"${EXTENSION_NAME}"`
    );
    if (alreadyAdded) return cfg;

    // ── Add extension target ────────────────────────────────────────────────
    const extTarget = project.addTarget(
      EXTENSION_NAME,
      "app_extension",
      EXTENSION_NAME,
      EXTENSION_BUNDLE_ID
    );

    // Fix: override product type to widgetkit-extension
    const ntSection = project.hash.project.objects["PBXNativeTarget"];
    if (ntSection[extTarget.uuid]) {
      ntSection[extTarget.uuid].productType =
        '"com.apple.product-type.widgetkit-extension"';
    }

    // Fix build settings for the extension
    const xcBuildCfg = project.hash.project.objects["XCBuildConfiguration"] || {};
    const cfgListSection = project.hash.project.objects["XCConfigurationList"] || {};
    const extCfgListUUID = ntSection[extTarget.uuid]?.buildConfigurationList;
    const extCfgList = cfgListSection[extCfgListUUID];
    if (extCfgList && extCfgList.buildConfigurations) {
      for (const ref of extCfgList.buildConfigurations) {
        const bc = xcBuildCfg[ref.value];
        if (!bc) continue;
        bc.buildSettings.INFOPLIST_FILE = `"${EXTENSION_NAME}/Info.plist"`;
        bc.buildSettings.SWIFT_VERSION = "5.0";
        bc.buildSettings.TARGETED_DEVICE_FAMILY = '"1"';
        bc.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = "16.2";
        bc.buildSettings.APPLICATION_EXTENSION_API_ONLY = "YES";
        bc.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${EXTENSION_NAME}/${EXTENSION_NAME}.entitlements"`;
      }
    }

    // ── Add build phases to extension ───────────────────────────────────────
    project.addBuildPhase(
      [],
      "PBXSourcesBuildPhase",
      "Sources",
      extTarget.uuid
    );
    project.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      extTarget.uuid
    );
    project.addBuildPhase(
      [],
      "PBXResourcesBuildPhase",
      "Resources",
      extTarget.uuid
    );

    // ── Create group for extension files ────────────────────────────────────
    const extGroupResult = project.addPbxGroup(
      [],
      EXTENSION_NAME,
      EXTENSION_NAME
    );
    const extGroupUUID = extGroupResult.uuid;

    // Add extension group to the main project group
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

    // ── Add Swift extension source file to extension target ─────────────────
    project.addSourceFile(
      `${EXTENSION_NAME}/PaceUpLiveActivityWidget.swift`,
      { target: extTarget.uuid },
      extGroupUUID
    );

    // ── Add bridge files to the main (first) app target ─────────────────────
    const mainTargetInfo = project.getFirstTarget();
    const mainTargetUUID = mainTargetInfo.uuid;

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

    return cfg;
  });

  return config;
}

module.exports = withLiveActivity;
