/**
 * Expo config plugin: PaceUp Home Screen Widget
 *
 * What this does:
 *  1. Writes PaceUpWidgetBridge.m + PaceUpWidgetBridge.swift to ios/
 *     (React Native native module that writes App Group data + reloads timelines)
 *  2. Writes PaceUpWidget/ Swift extension (small + medium WidgetKit widgets
 *     showing weekly miles and the next scheduled run)
 *  3. Adds both sets of files to the correct Xcode targets
 *  4. Writes the extension Info.plist and App Group entitlements file
 */

const {
  withXcodeProject,
  withDangerousMod,
} = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

const WIDGET_NAME = "PaceUpWidget";
const WIDGET_BUNDLE_ID = "com.paceup.PaceUpWidget";
const APP_GROUP = "group.com.paceup";

// ─── Swift/ObjC source templates ─────────────────────────────────────────────

const WIDGET_BRIDGE_M = `\
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PaceUpWidgetBridge, NSObject)

RCT_EXTERN_METHOD(updateWidgetData:(NSDictionary *)data
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
`;

const WIDGET_BRIDGE_SWIFT = `\
import Foundation
import WidgetKit

@objc(PaceUpWidgetBridge)
class PaceUpWidgetBridge: NSObject {

  @objc func updateWidgetData(
    _ data: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    guard let defaults = UserDefaults(suiteName: "${APP_GROUP}") else {
      resolve(nil); return
    }
    if let v = data["nextRunTitle"] as? String { defaults.set(v, forKey: "nextRunTitle") }
    if let v = data["nextRunTime"] as? String { defaults.set(v, forKey: "nextRunTime") }
    if let v = data["weeklyMiles"] as? Double { defaults.set(v, forKey: "weeklyMiles") }
    if let v = data["monthlyGoal"] as? Double { defaults.set(v, forKey: "monthlyGoal") }
    defaults.synchronize()
    WidgetCenter.shared.reloadAllTimelines()
    resolve(nil)
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }
}
`;

const WIDGET_SWIFT = `\
import WidgetKit
import SwiftUI

private let kAppGroup = "${APP_GROUP}"

// MARK: - Timeline

struct PaceUpWidgetEntry: TimelineEntry {
  let date: Date
  let nextRunTitle: String
  let nextRunTime: String
  let weeklyMiles: Double
  let monthlyGoal: Double
}

struct PaceUpWidgetProvider: TimelineProvider {
  func placeholder(in _: Context) -> PaceUpWidgetEntry {
    PaceUpWidgetEntry(
      date: Date(), nextRunTitle: "Morning Run",
      nextRunTime: "Tomorrow 7:00 AM", weeklyMiles: 12.4, monthlyGoal: 50
    )
  }

  func getSnapshot(in _: Context, completion: @escaping (PaceUpWidgetEntry) -> Void) {
    completion(makeEntry())
  }

  func getTimeline(in _: Context, completion: @escaping (Timeline<PaceUpWidgetEntry>) -> Void) {
    let e = makeEntry()
    let refresh = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
    completion(Timeline(entries: [e], policy: .after(refresh)))
  }

  private func makeEntry() -> PaceUpWidgetEntry {
    let d = UserDefaults(suiteName: kAppGroup)
    return PaceUpWidgetEntry(
      date: Date(),
      nextRunTitle: d?.string(forKey: "nextRunTitle") ?? "",
      nextRunTime: d?.string(forKey: "nextRunTime") ?? "",
      weeklyMiles: d?.double(forKey: "weeklyMiles") ?? 0,
      monthlyGoal: d?.double(forKey: "monthlyGoal") ?? 0
    )
  }
}

// MARK: - Views

private let kGreen = Color(red: 0, green: 0.851, blue: 0.494)
private let kBg = Color(red: 5 / 255, green: 12 / 255, blue: 9 / 255)

struct PaceUpSmallView: View {
  let e: PaceUpWidgetEntry
  var body: some View {
    ZStack(alignment: .topLeading) {
      kBg
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 4) {
          Image(systemName: "figure.run")
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(kGreen)
          Text("PaceUp")
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(kGreen)
        }
        Spacer()
        Text(String(format: "%.1f", e.weeklyMiles))
          .font(.system(size: 30, weight: .bold))
          .foregroundColor(.white)
        Text("mi this week")
          .font(.system(size: 11, weight: .medium))
          .foregroundColor(.gray)
        if e.monthlyGoal > 0 {
          let pct = min(e.weeklyMiles * 4 / e.monthlyGoal, 1.0)
          GeometryReader { g in
            ZStack(alignment: .leading) {
              Capsule().fill(Color.white.opacity(0.15)).frame(height: 4)
              Capsule().fill(kGreen).frame(width: g.size.width * pct, height: 4)
            }
          }
          .frame(height: 4)
        }
      }
      .padding(12)
    }
  }
}

struct PaceUpMediumView: View {
  let e: PaceUpWidgetEntry
  var body: some View {
    ZStack {
      kBg
      HStack(spacing: 16) {
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 4) {
            Image(systemName: "figure.run")
              .font(.system(size: 12, weight: .semibold))
              .foregroundColor(kGreen)
            Text("PaceUp")
              .font(.system(size: 11, weight: .bold))
              .foregroundColor(kGreen)
          }
          Spacer()
          Text(String(format: "%.1f mi", e.weeklyMiles))
            .font(.system(size: 22, weight: .bold))
            .foregroundColor(.white)
          Text("this week")
            .font(.system(size: 11))
            .foregroundColor(.gray)
          if e.monthlyGoal > 0 {
            let pct = min(e.weeklyMiles * 4 / e.monthlyGoal, 1.0)
            GeometryReader { g in
              ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.15)).frame(height: 4)
                Capsule().fill(kGreen).frame(width: g.size.width * pct, height: 4)
              }
            }
            .frame(height: 4)
            Text(String(format: "Goal: %.0f mi/mo", e.monthlyGoal))
              .font(.system(size: 10))
              .foregroundColor(.gray)
          }
        }
        .frame(maxWidth: .infinity)

        if !e.nextRunTitle.isEmpty {
          Rectangle().fill(Color.white.opacity(0.12)).frame(width: 1)
          VStack(alignment: .leading, spacing: 4) {
            Text("NEXT RUN")
              .font(.system(size: 9, weight: .semibold))
              .foregroundColor(.gray)
            Text(e.nextRunTitle)
              .font(.system(size: 13, weight: .semibold))
              .foregroundColor(.white)
              .lineLimit(2)
            if !e.nextRunTime.isEmpty {
              Text(e.nextRunTime)
                .font(.system(size: 11))
                .foregroundColor(.gray)
            }
            Spacer()
            Image(systemName: "chevron.right.circle.fill")
              .foregroundColor(kGreen)
              .font(.system(size: 18))
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      .padding(14)
    }
  }
}

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

// MARK: - Widget + Bundle

struct PaceUpWidget: Widget {
  let kind = "PaceUpWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: PaceUpWidgetProvider()) { entry in
      if #available(iOS 17.0, *) {
        PaceUpWidgetEntryView(entry: entry)
          .containerBackground(kBg, for: .widget)
      } else {
        PaceUpWidgetEntryView(entry: entry)
      }
    }
    .configurationDisplayName("PaceUp")
    .description("Weekly miles and your next run.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

@main
struct PaceUpWidgetBundle: WidgetBundle {
  var body: some Widget { PaceUpWidget() }
}
`;

const WIDGET_INFO_PLIST = `\
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

const WIDGET_ENTITLEMENTS = `\
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

// ─── Plugin ──────────────────────────────────────────────────────────────────

function withWidget(config) {
  // 1. Write native source files into ios/
  config = withDangerousMod(config, [
    "ios",
    (cfg) => {
      const iosRoot = cfg.modRequest.platformProjectRoot;

      // Widget bridge files → main app target
      fs.writeFileSync(
        path.join(iosRoot, "PaceUpWidgetBridge.m"),
        WIDGET_BRIDGE_M,
        "utf8"
      );
      fs.writeFileSync(
        path.join(iosRoot, "PaceUpWidgetBridge.swift"),
        WIDGET_BRIDGE_SWIFT,
        "utf8"
      );

      // Widget extension directory + files
      const widgetDir = path.join(iosRoot, WIDGET_NAME);
      fs.mkdirSync(widgetDir, { recursive: true });
      fs.writeFileSync(
        path.join(widgetDir, "PaceUpWidget.swift"),
        WIDGET_SWIFT,
        "utf8"
      );
      fs.writeFileSync(
        path.join(widgetDir, "Info.plist"),
        WIDGET_INFO_PLIST,
        "utf8"
      );
      fs.writeFileSync(
        path.join(widgetDir, `${WIDGET_NAME}.entitlements`),
        WIDGET_ENTITLEMENTS,
        "utf8"
      );

      return cfg;
    },
  ]);

  // 2. Xcode project: add targets and source files
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;

    // Idempotency: skip if widget target already exists
    const nativeTargets = project.hash.project.objects["PBXNativeTarget"] || {};
    const alreadyAdded = Object.entries(nativeTargets).some(
      ([key, val]) => !key.endsWith("_comment") && val.name === `"${WIDGET_NAME}"`
    );
    if (alreadyAdded) return cfg;

    // ── Add widget extension target ─────────────────────────────────────────
    const widgetTarget = project.addTarget(
      WIDGET_NAME,
      "app_extension",
      WIDGET_NAME,
      WIDGET_BUNDLE_ID
    );

    // Fix product type to widgetkit-extension
    const ntSection = project.hash.project.objects["PBXNativeTarget"];
    if (ntSection[widgetTarget.uuid]) {
      ntSection[widgetTarget.uuid].productType =
        '"com.apple.product-type.widgetkit-extension"';
    }

    // Fix build settings for the widget extension
    const xcBuildCfg = project.hash.project.objects["XCBuildConfiguration"] || {};
    const cfgListSection = project.hash.project.objects["XCConfigurationList"] || {};
    const widgetCfgListUUID = ntSection[widgetTarget.uuid]?.buildConfigurationList;
    const widgetCfgList = cfgListSection[widgetCfgListUUID];
    if (widgetCfgList && widgetCfgList.buildConfigurations) {
      for (const ref of widgetCfgList.buildConfigurations) {
        const bc = xcBuildCfg[ref.value];
        if (!bc) continue;
        bc.buildSettings.INFOPLIST_FILE = `"${WIDGET_NAME}/Info.plist"`;
        bc.buildSettings.SWIFT_VERSION = "5.0";
        bc.buildSettings.TARGETED_DEVICE_FAMILY = '"1"';
        bc.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = "16.0";
        bc.buildSettings.APPLICATION_EXTENSION_API_ONLY = "YES";
        bc.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${WIDGET_NAME}/${WIDGET_NAME}.entitlements"`;
      }
    }

    // ── Add build phases to widget target ───────────────────────────────────
    project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", widgetTarget.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", widgetTarget.uuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", widgetTarget.uuid);

    // ── Create group for widget files ────────────────────────────────────────
    const widgetGroupResult = project.addPbxGroup([], WIDGET_NAME, WIDGET_NAME);
    const widgetGroupUUID = widgetGroupResult.uuid;

    // Add widget group to the main project group
    const mainProjectInfo = project.getFirstProject();
    const mainGroupUUID = mainProjectInfo.firstProject.mainGroup;
    const pbxGroups = project.hash.project.objects["PBXGroup"] || {};
    if (pbxGroups[mainGroupUUID]) {
      pbxGroups[mainGroupUUID].children = pbxGroups[mainGroupUUID].children || [];
      pbxGroups[mainGroupUUID].children.push({
        value: widgetGroupUUID,
        comment: WIDGET_NAME,
      });
    }

    // ── Add Swift widget source to widget target ─────────────────────────────
    project.addSourceFile(
      `${WIDGET_NAME}/PaceUpWidget.swift`,
      { target: widgetTarget.uuid },
      widgetGroupUUID
    );

    // ── Add widget bridge files to main (first) app target ───────────────────
    const mainTargetInfo = project.getFirstTarget();
    const mainTargetUUID = mainTargetInfo.uuid;

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

module.exports = withWidget;
