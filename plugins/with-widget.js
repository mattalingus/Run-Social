/**
 * Expo config plugin: PaceUp Home Screen Widget
 *
 * What this does:
 *  1. Writes PaceUpWidgetBridge.m + PaceUpWidgetBridge.swift to ios/
 *     (React Native native module that writes a JSON file to the App Group
 *     shared container, then reloads WidgetKit timelines)
 *  2. Writes PaceUpWidget/ Swift extension (small + medium WidgetKit widgets)
 *     - Small: next upcoming run + time until start
 *     - Medium: next run + distance range + weekly progress toward monthly goal
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
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
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

const WIDGET_SWIFT = `\
import WidgetKit
import SwiftUI

private let kAppGroup = "${APP_GROUP}"
private let kDataFile = "widget_data.json"

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

private let kGreen = Color(red: 0, green: 0.851, blue: 0.494)
private let kBg    = Color(red: 5 / 255, green: 12 / 255, blue: 9 / 255)

private func timeUntilLabel(timestamp: Double) -> String {
  guard timestamp > 0 else { return "" }
  let seconds = timestamp - Date().timeIntervalSince1970
  guard seconds > 0 else { return "Starting soon" }
  let hours = Int(seconds) / 3600
  let minutes = (Int(seconds) % 3600) / 60
  if hours >= 24 {
    let days = hours / 24
    return "in \\(days)d"
  }
  if hours >= 1 { return "in \\(hours)h \\(minutes)m" }
  if minutes >= 1 { return "in \\(minutes)m" }
  return "Starting soon"
}

// MARK: - Small widget: next upcoming run

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
          let untilLabel = timeUntilLabel(timestamp: e.payload.nextRunTimestamp)
          if !untilLabel.isEmpty {
            Text(untilLabel)
              .font(.system(size: 12, weight: .semibold))
              .foregroundColor(kGreen)
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

// MARK: - Medium widget: next run + weekly progress

struct PaceUpMediumView: View {
  let e: PaceUpWidgetEntry
  var body: some View {
    ZStack {
      kBg
      HStack(spacing: 16) {

        // Left: next run
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
            let untilLabel = timeUntilLabel(timestamp: e.payload.nextRunTimestamp)
            if !untilLabel.isEmpty {
              Text(untilLabel)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(kGreen)
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

        // Right: weekly progress
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
                Capsule().fill(kGreen).frame(width: g.size.width * pct, height: 4)
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

// MARK: - Entry view + Widget

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
    .description("Your next run and weekly progress.")
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
