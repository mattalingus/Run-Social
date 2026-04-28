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
    var startedAt: Double
    var isPaused: Bool
    var distanceUnit: String
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
    let elapsed = data["elapsedSeconds"] as? Int ?? 0
    let nowTs = Date().timeIntervalSince1970
    let state = PaceUpLiveActivityAttributes.ContentState(
      elapsedSeconds: elapsed,
      distanceMiles: data["distanceMiles"] as? Double ?? 0.0,
      paceMinPerMile: data["paceMinPerMile"] as? Double ?? 0.0,
      activityType: t,
      startedAt: (data["startedAt"] as? Double) ?? (nowTs - Double(elapsed)),
      isPaused: (data["isPaused"] as? Bool) ?? false,
      distanceUnit: (data["distanceUnit"] as? String) ?? "mi"
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
    let elapsed = data["elapsedSeconds"] as? Int ?? 0
    let nowTs = Date().timeIntervalSince1970
    let state = PaceUpLiveActivityAttributes.ContentState(
      elapsedSeconds: elapsed,
      distanceMiles: data["distanceMiles"] as? Double ?? 0.0,
      paceMinPerMile: data["paceMinPerMile"] as? Double ?? 0.0,
      activityType: t,
      startedAt: (data["startedAt"] as? Double) ?? (nowTs - Double(elapsed)),
      isPaused: (data["isPaused"] as? Bool) ?? false,
      distanceUnit: (data["distanceUnit"] as? String) ?? "mi"
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
    let elapsed = data["elapsedSeconds"] as? Int ?? 0
    let nowTs = Date().timeIntervalSince1970
    let state = PaceUpLiveActivityAttributes.ContentState(
      elapsedSeconds: elapsed,
      distanceMiles: data["distanceMiles"] as? Double ?? 0.0,
      paceMinPerMile: data["paceMinPerMile"] as? Double ?? 0.0,
      activityType: t,
      startedAt: (data["startedAt"] as? Double) ?? (nowTs - Double(elapsed)),
      isPaused: (data["isPaused"] as? Bool) ?? false,
      distanceUnit: (data["distanceUnit"] as? String) ?? "mi"
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
    var startedAt: Double
    var isPaused: Bool
    var distanceUnit: String
  }
  var activityName: String
}
`;

// PaceUpLiveActivity.swift — Dynamic Island + Lock Screen Live Activity widget
const LIVE_ACTIVITY_SWIFT = `\
import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Brand Tokens

private let kGreen      = Color(red: 0, green: 0.851, blue: 0.494)    // PaceUp primary
private let kGreenSoft  = Color(red: 0, green: 0.851, blue: 0.494).opacity(0.18)
private let kBg         = Color(red: 5 / 255,  green: 12 / 255, blue: 9 / 255)
private let kCard       = Color(red: 18 / 255, green: 28 / 255, blue: 22 / 255)
private let kTextDim    = Color.white.opacity(0.55)
private let kTextMuted  = Color.white.opacity(0.38)
private let kAmber      = Color(red: 1.0, green: 0.72, blue: 0.0)      // paused accent

// MARK: - Helpers

private func actIcon(_ t: String) -> String {
  switch t.lowercased() {
  case "ride": return "bicycle"
  case "walk": return "figure.walk"
  default:     return "figure.run"
  }
}

private func actLabel(_ t: String) -> String {
  switch t.lowercased() {
  case "ride": return "Ride"
  case "walk": return "Walk"
  default:     return "Run"
  }
}

private func paceLabel(_ unit: String, _ t: String) -> String {
  if t.lowercased() == "ride" { return unit == "km" ? "km/h" : "mph" }
  return unit == "km" ? "/km" : "/mi"
}

private func distLabel(_ unit: String) -> String { unit == "km" ? "km" : "mi" }

private func fmtStaticTime(_ s: Int) -> String {
  let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
  if h > 0 { return String(format: "%d:%02d:%02d", h, m, sec) }
  return String(format: "%d:%02d", m, sec)
}

private func fmtDist(_ miles: Double, unit: String) -> String {
  let v = unit == "km" ? miles * 1.609344 : miles
  return String(format: "%.2f", v)
}

private func fmtPace(_ p: Double, unit: String, activity: String) -> String {
  // For rides, paceMinPerMile is actually speed-derived; show mph/kmh
  if activity.lowercased() == "ride" {
    guard p > 0 else { return "--" }
    let mph = 60.0 / p
    let v = unit == "km" ? mph * 1.609344 : mph
    return String(format: "%.1f", v)
  }
  // Run/walk: min per mile → min per km if unit=km
  guard p > 0 else { return "--:--" }
  let pAdj = unit == "km" ? p / 1.609344 : p
  let m = Int(pAdj), s = Int((pAdj - Double(m)) * 60)
  return String(format: "%d:%02d", m, s)
}

/// Live-ticking timer that self-updates on the lock screen without needing
/// update pushes from the app. Anchored to \`startedAt\`. When paused we
/// render a static snapshot instead so the display freezes at the exact
/// paused value.
@ViewBuilder
private func liveTimer(state: PaceUpLiveActivityAttributes.ContentState,
                       font: Font) -> some View {
  if state.isPaused {
    Text(fmtStaticTime(state.elapsedSeconds))
      .font(font)
      .monospacedDigit()
      .foregroundColor(.white)
  } else {
    Text(Date(timeIntervalSince1970: state.startedAt), style: .timer)
      .font(font)
      .monospacedDigit()
      .foregroundColor(.white)
      .multilineTextAlignment(.leading)
  }
}

// MARK: - Small Reusable Pieces

private struct StatBlock: View {
  let label: String
  let value: String
  let unit: String
  var align: HorizontalAlignment = .leading
  var body: some View {
    VStack(alignment: align, spacing: 2) {
      Text(label)
        .font(.system(size: 10, weight: .semibold))
        .tracking(1.0)
        .foregroundColor(kTextMuted)
      HStack(alignment: .lastTextBaseline, spacing: 3) {
        Text(value)
          .font(.system(size: 22, weight: .heavy, design: .rounded))
          .monospacedDigit()
          .foregroundColor(.white)
        Text(unit)
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .foregroundColor(kTextDim)
      }
    }
  }
}

private struct StatusPill: View {
  let isPaused: Bool
  var body: some View {
    HStack(spacing: 5) {
      Circle()
        .fill(isPaused ? kAmber : kGreen)
        .frame(width: 6, height: 6)
      Text(isPaused ? "PAUSED" : "LIVE")
        .font(.system(size: 10, weight: .bold, design: .rounded))
        .tracking(0.8)
        .foregroundColor(isPaused ? kAmber : kGreen)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(
      Capsule().fill((isPaused ? kAmber : kGreen).opacity(0.15))
    )
  }
}

// MARK: - Lock Screen / Notification Banner View

struct PaceUpLockScreenView: View {
  let ctx: ActivityViewContext<PaceUpLiveActivityAttributes>

  var body: some View {
    let s = ctx.state
    VStack(spacing: 0) {
      // ── Top row: brand chip + status ─────────────────────────────────────
      HStack(spacing: 10) {
        ZStack {
          Circle()
            .fill(kGreenSoft)
            .frame(width: 28, height: 28)
          Image(systemName: actIcon(s.activityType))
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(kGreen)
        }
        VStack(alignment: .leading, spacing: 0) {
          Text("PACEUP")
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .tracking(1.4)
            .foregroundColor(kGreen)
          Text(actLabel(s.activityType) + " in progress")
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(.white)
        }
        Spacer()
        StatusPill(isPaused: s.isPaused)
      }

      // ── Hero: live-ticking timer ─────────────────────────────────────────
      HStack(alignment: .firstTextBaseline) {
        liveTimer(state: s, font: .system(size: 44, weight: .heavy, design: .rounded))
        Spacer(minLength: 0)
      }
      .padding(.top, 10)

      Text("ELAPSED")
        .font(.system(size: 9, weight: .bold, design: .rounded))
        .tracking(1.2)
        .foregroundColor(kTextMuted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, -2)

      // ── Stats row: distance + pace/speed ─────────────────────────────────
      HStack(spacing: 0) {
        StatBlock(
          label: "DISTANCE",
          value: fmtDist(s.distanceMiles, unit: s.distanceUnit),
          unit: distLabel(s.distanceUnit)
        )
        Spacer()
        Rectangle()
          .fill(Color.white.opacity(0.08))
          .frame(width: 1, height: 34)
        Spacer()
        StatBlock(
          label: s.activityType.lowercased() == "ride" ? "SPEED" : "PACE",
          value: fmtPace(s.paceMinPerMile, unit: s.distanceUnit, activity: s.activityType),
          unit: paceLabel(s.distanceUnit, s.activityType),
          align: .trailing
        )
      }
      .padding(.top, 14)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 14)
  }
}

// MARK: - Live Activity Widget

struct PaceUpLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PaceUpLiveActivityAttributes.self) { ctx in
      PaceUpLockScreenView(ctx: ctx)
        .activityBackgroundTint(kBg)
        .activitySystemActionForegroundColor(kGreen)
    } dynamicIsland: { ctx in
      let s = ctx.state
      return DynamicIsland {
        // ── Expanded ───────────────────────────────────────────────────────
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 8) {
            ZStack {
              Circle().fill(kGreenSoft).frame(width: 24, height: 24)
              Image(systemName: actIcon(s.activityType))
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(kGreen)
            }
            VStack(alignment: .leading, spacing: -1) {
              Text("PACEUP")
                .font(.system(size: 8, weight: .bold, design: .rounded))
                .tracking(1.2)
                .foregroundColor(kGreen)
              Text(actLabel(s.activityType))
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.white)
            }
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          StatusPill(isPaused: s.isPaused)
        }
        DynamicIslandExpandedRegion(.center) {
          liveTimer(state: s, font: .system(size: 34, weight: .heavy, design: .rounded))
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack(spacing: 0) {
            StatBlock(
              label: "DISTANCE",
              value: fmtDist(s.distanceMiles, unit: s.distanceUnit),
              unit: distLabel(s.distanceUnit)
            )
            Spacer()
            Rectangle().fill(Color.white.opacity(0.08)).frame(width: 1, height: 28)
            Spacer()
            StatBlock(
              label: s.activityType.lowercased() == "ride" ? "SPEED" : "PACE",
              value: fmtPace(s.paceMinPerMile, unit: s.distanceUnit, activity: s.activityType),
              unit: paceLabel(s.distanceUnit, s.activityType),
              align: .trailing
            )
          }
          .padding(.top, 4)
        }
      } compactLeading: {
        Image(systemName: actIcon(s.activityType))
          .foregroundColor(kGreen)
      } compactTrailing: {
        // Live ticker so the Dynamic Island itself pulses with the timer
        if s.isPaused {
          Text(fmtStaticTime(s.elapsedSeconds))
            .font(.system(size: 13, weight: .bold, design: .rounded))
            .monospacedDigit()
            .foregroundColor(kAmber)
        } else {
          Text(Date(timeIntervalSince1970: s.startedAt), style: .timer)
            .font(.system(size: 13, weight: .bold, design: .rounded))
            .monospacedDigit()
            .foregroundColor(.white)
            .frame(maxWidth: 58)
            .multilineTextAlignment(.trailing)
        }
      } minimal: {
        Image(systemName: actIcon(s.activityType))
          .foregroundColor(s.isPaused ? kAmber : kGreen)
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

// Brand tokens — match the Live Activity + in-app theme
private let kGreenW      = Color(red: 0, green: 0.851, blue: 0.494)
private let kGreenSoftW  = Color(red: 0, green: 0.851, blue: 0.494).opacity(0.18)
private let kBgW         = Color(red: 5 / 255,  green: 12 / 255, blue: 9 / 255)
private let kBgWTop      = Color(red: 12 / 255, green: 22 / 255, blue: 17 / 255)
private let kTextDimW    = Color.white.opacity(0.55)
private let kTextMutedW  = Color.white.opacity(0.38)
private let kHairline    = Color.white.opacity(0.08)

// MARK: - Data model

struct WidgetPayload: Codable {
  var nextRunTitle: String
  var nextRunTimestamp: Double
  var distanceRangeMiles: String
  var weeklyMiles: Double
  var monthlyGoal: Double
  // Optional — older app builds won't write these. Defaults via decoder below.
  var distanceUnit: String?
  var currentStreak: Int?
  var totalRuns: Int?
}

extension WidgetPayload {
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    nextRunTitle       = (try? c.decode(String.self, forKey: .nextRunTitle)) ?? ""
    nextRunTimestamp   = (try? c.decode(Double.self, forKey: .nextRunTimestamp)) ?? 0
    distanceRangeMiles = (try? c.decode(String.self, forKey: .distanceRangeMiles)) ?? ""
    weeklyMiles        = (try? c.decode(Double.self, forKey: .weeklyMiles)) ?? 0
    monthlyGoal        = (try? c.decode(Double.self, forKey: .monthlyGoal)) ?? 0
    distanceUnit       = (try? c.decode(String.self, forKey: .distanceUnit))
    currentStreak      = (try? c.decode(Int.self,    forKey: .currentStreak))
    totalRuns          = (try? c.decode(Int.self,    forKey: .totalRuns))
  }
}

// MARK: - Timeline entry + provider

struct PaceUpWidgetEntry: TimelineEntry {
  let date: Date
  let payload: WidgetPayload
}

struct PaceUpWidgetProvider: TimelineProvider {

  func placeholder(in _: Context) -> PaceUpWidgetEntry {
    PaceUpWidgetEntry(
      date: Date(),
      payload: WidgetPayload(
        nextRunTitle: "Morning Run",
        nextRunTimestamp: Date().addingTimeInterval(3600).timeIntervalSince1970,
        distanceRangeMiles: "3-5",
        weeklyMiles: 12.4,
        monthlyGoal: 50,
        distanceUnit: "mi",
        currentStreak: 4,
        totalRuns: 87
      )
    )
  }

  func getSnapshot(in _: Context, completion: @escaping (PaceUpWidgetEntry) -> Void) {
    completion(makeEntry())
  }

  func getTimeline(in _: Context, completion: @escaping (Timeline<PaceUpWidgetEntry>) -> Void) {
    // Refresh every 10 minutes so the "in 23m" countdown stays accurate
    let e = makeEntry()
    let refresh = Calendar.current.date(byAdding: .minute, value: 10, to: Date()) ?? Date()
    completion(Timeline(entries: [e], policy: .after(refresh)))
  }

  private func makeEntry() -> PaceUpWidgetEntry {
    var payload = WidgetPayload(
      nextRunTitle: "",
      nextRunTimestamp: 0,
      distanceRangeMiles: "",
      weeklyMiles: 0,
      monthlyGoal: 0,
      distanceUnit: "mi",
      currentStreak: 0,
      totalRuns: 0
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

private func distUnit(_ p: WidgetPayload) -> String { p.distanceUnit ?? "mi" }

private func convertedMiles(_ mi: Double, unit: String) -> Double {
  unit == "km" ? mi * 1.609344 : mi
}

private func fmtMiles(_ mi: Double, unit: String) -> String {
  String(format: "%.1f", convertedMiles(mi, unit: unit))
}

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

// Short relative label for tight spaces ("2h 14m" / "23m" / "NOW")
private func shortTimeUntil(_ timestamp: Double) -> String {
  guard timestamp > 0 else { return "" }
  let seconds = timestamp - Date().timeIntervalSince1970
  guard seconds > 0 else { return "NOW" }
  let hours = Int(seconds) / 3600
  let minutes = (Int(seconds) % 3600) / 60
  if hours >= 24 { return "\\(hours / 24)d" }
  if hours >= 1  { return "\\(hours)h \\(minutes)m" }
  return "\\(minutes)m"
}

// MARK: - Shared visuals

private struct BrandHeader: View {
  var subtitle: String? = nil
  var body: some View {
    HStack(spacing: 6) {
      ZStack {
        Circle().fill(kGreenSoftW).frame(width: 20, height: 20)
        Image(systemName: "figure.run")
          .font(.system(size: 10, weight: .bold))
          .foregroundColor(kGreenW)
      }
      Text("PACEUP")
        .font(.system(size: 10, weight: .bold, design: .rounded))
        .tracking(1.4)
        .foregroundColor(kGreenW)
      if let s = subtitle {
        Text("·")
          .font(.system(size: 10, weight: .bold))
          .foregroundColor(kTextMutedW)
        Text(s)
          .font(.system(size: 10, weight: .semibold, design: .rounded))
          .tracking(0.6)
          .foregroundColor(kTextDimW)
      }
    }
  }
}

private struct TimeUntilPill: View {
  let timestamp: Double
  var body: some View {
    let s = shortTimeUntil(timestamp)
    HStack(spacing: 4) {
      Image(systemName: "clock.fill")
        .font(.system(size: 8, weight: .bold))
      Text("IN \\(s)")
        .font(.system(size: 10, weight: .bold, design: .rounded))
        .tracking(0.6)
    }
    .foregroundColor(kGreenW)
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(Capsule().fill(kGreenSoftW))
  }
}

private struct WeeklyGoalRing: View {
  let weeklyMiles: Double
  let weeklyGoal: Double
  let unit: String
  var size: CGFloat = 68
  var body: some View {
    let pct = weeklyGoal > 0 ? min(weeklyMiles / weeklyGoal, 1.0) : 0
    ZStack {
      Circle()
        .stroke(Color.white.opacity(0.1), lineWidth: 6)
      Circle()
        .trim(from: 0, to: pct)
        .stroke(
          AngularGradient(
            gradient: Gradient(colors: [kGreenW.opacity(0.7), kGreenW]),
            center: .center
          ),
          style: StrokeStyle(lineWidth: 6, lineCap: .round)
        )
        .rotationEffect(.degrees(-90))
      VStack(spacing: -1) {
        Text(String(format: "%.0f%%", pct * 100))
          .font(.system(size: 16, weight: .heavy, design: .rounded))
          .monospacedDigit()
          .foregroundColor(.white)
        Text("GOAL")
          .font(.system(size: 7, weight: .bold, design: .rounded))
          .tracking(1.0)
          .foregroundColor(kTextMutedW)
      }
    }
    .frame(width: size, height: size)
  }
}

// MARK: - Small widget view

struct PaceUpSmallView: View {
  let e: PaceUpWidgetEntry
  var body: some View {
    let p = e.payload
    let unit = distUnit(p)
    VStack(alignment: .leading, spacing: 0) {
      BrandHeader()
      Spacer(minLength: 6)

      if p.nextRunTitle.isEmpty {
        // ── Empty state: show weekly progress instead ──
        Text("THIS WEEK")
          .font(.system(size: 9, weight: .bold, design: .rounded))
          .tracking(1.2)
          .foregroundColor(kTextMutedW)
        HStack(alignment: .lastTextBaseline, spacing: 3) {
          Text(fmtMiles(p.weeklyMiles, unit: unit))
            .font(.system(size: 30, weight: .heavy, design: .rounded))
            .monospacedDigit()
            .foregroundColor(.white)
          Text(unit)
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .foregroundColor(kTextDimW)
        }
        if p.monthlyGoal > 0 {
          let weeklyGoal = p.monthlyGoal / 4.345
          let pct = min(p.weeklyMiles / weeklyGoal, 1.0)
          GeometryReader { g in
            ZStack(alignment: .leading) {
              Capsule().fill(Color.white.opacity(0.1)).frame(height: 5)
              Capsule()
                .fill(LinearGradient(colors: [kGreenW.opacity(0.7), kGreenW], startPoint: .leading, endPoint: .trailing))
                .frame(width: max(5, g.size.width * pct), height: 5)
            }
          }
          .frame(height: 5)
          .padding(.top, 6)
          Text(String(format: "%.0f%% of weekly goal", pct * 100))
            .font(.system(size: 9, weight: .semibold, design: .rounded))
            .foregroundColor(kTextDimW)
            .padding(.top, 3)
        } else {
          Text("Set a goal to track progress")
            .font(.system(size: 9, weight: .medium))
            .foregroundColor(kTextMutedW)
            .padding(.top, 4)
        }
      } else {
        // ── Next run state ──
        Text("NEXT UP")
          .font(.system(size: 9, weight: .bold, design: .rounded))
          .tracking(1.2)
          .foregroundColor(kTextMutedW)
          .padding(.top, 2)
        Text(p.nextRunTitle)
          .font(.system(size: 15, weight: .heavy, design: .rounded))
          .foregroundColor(.white)
          .lineLimit(2)
          .padding(.top, 1)

        Spacer(minLength: 4)

        HStack(spacing: 6) {
          TimeUntilPill(timestamp: p.nextRunTimestamp)
          if !p.distanceRangeMiles.isEmpty {
            Text(p.distanceRangeMiles + " " + unit)
              .font(.system(size: 10, weight: .semibold, design: .rounded))
              .foregroundColor(kTextDimW)
          }
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(URL(string: "paceup://discover")!)
  }
}

// MARK: - Medium widget view

struct PaceUpMediumView: View {
  let e: PaceUpWidgetEntry
  var body: some View {
    let p = e.payload
    let unit = distUnit(p)
    HStack(spacing: 14) {
      // ── Left: Next run / empty state ───────────────────────────────
      VStack(alignment: .leading, spacing: 0) {
        BrandHeader(subtitle: "NEXT UP")
        Spacer(minLength: 8)
        if p.nextRunTitle.isEmpty {
          VStack(alignment: .leading, spacing: 4) {
            Text("No events scheduled")
              .font(.system(size: 13, weight: .semibold, design: .rounded))
              .foregroundColor(.white)
            Text("Tap to discover runs near you")
              .font(.system(size: 10, weight: .medium))
              .foregroundColor(kTextMutedW)
          }
        } else {
          Text(p.nextRunTitle)
            .font(.system(size: 16, weight: .heavy, design: .rounded))
            .foregroundColor(.white)
            .lineLimit(2)
            .minimumScaleFactor(0.85)
          Spacer(minLength: 6)
          HStack(spacing: 6) {
            TimeUntilPill(timestamp: p.nextRunTimestamp)
            if !p.distanceRangeMiles.isEmpty {
              Text(p.distanceRangeMiles + " " + unit)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundColor(kTextDimW)
            }
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

      Rectangle().fill(kHairline).frame(width: 1)

      // ── Right: Weekly progress ring + stats ────────────────────────
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 4) {
          Text("THIS WEEK")
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .tracking(1.2)
            .foregroundColor(kTextMutedW)
          Spacer()
          if let streak = p.currentStreak, streak > 0 {
            HStack(spacing: 2) {
              Text("🔥")
                .font(.system(size: 9))
              Text("\\(streak)")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundColor(.white)
            }
          }
        }

        Spacer(minLength: 4)

        HStack(spacing: 12) {
          if p.monthlyGoal > 0 {
            let weeklyGoal = p.monthlyGoal / 4.345
            WeeklyGoalRing(weeklyMiles: p.weeklyMiles, weeklyGoal: weeklyGoal, unit: unit, size: 64)
          } else {
            // No goal — compact hero number instead of the ring
            VStack(alignment: .leading, spacing: -2) {
              HStack(alignment: .lastTextBaseline, spacing: 2) {
                Text(fmtMiles(p.weeklyMiles, unit: unit))
                  .font(.system(size: 28, weight: .heavy, design: .rounded))
                  .monospacedDigit()
                  .foregroundColor(.white)
                Text(unit)
                  .font(.system(size: 11, weight: .semibold, design: .rounded))
                  .foregroundColor(kTextDimW)
              }
              Text("NO GOAL SET")
                .font(.system(size: 8, weight: .bold, design: .rounded))
                .tracking(1.0)
                .foregroundColor(kTextMutedW)
            }
            .frame(width: 64, alignment: .leading)
          }

          VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: -1) {
              HStack(alignment: .lastTextBaseline, spacing: 2) {
                Text(fmtMiles(p.weeklyMiles, unit: unit))
                  .font(.system(size: 18, weight: .heavy, design: .rounded))
                  .monospacedDigit()
                  .foregroundColor(.white)
                Text(unit)
                  .font(.system(size: 9, weight: .semibold, design: .rounded))
                  .foregroundColor(kTextDimW)
              }
              Text("LOGGED")
                .font(.system(size: 8, weight: .bold, design: .rounded))
                .tracking(1.0)
                .foregroundColor(kTextMutedW)
            }

            if p.monthlyGoal > 0 {
              let weeklyGoal = p.monthlyGoal / 4.345
              let remaining = max(0, weeklyGoal - p.weeklyMiles)
              VStack(alignment: .leading, spacing: -1) {
                HStack(alignment: .lastTextBaseline, spacing: 2) {
                  Text(String(format: "%.1f", convertedMiles(remaining, unit: unit)))
                    .font(.system(size: 18, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(remaining > 0 ? .white : kGreenW)
                  Text(unit)
                    .font(.system(size: 9, weight: .semibold, design: .rounded))
                    .foregroundColor(kTextDimW)
                }
                Text(remaining > 0 ? "TO GO" : "GOAL HIT")
                  .font(.system(size: 8, weight: .bold, design: .rounded))
                  .tracking(1.0)
                  .foregroundColor(remaining > 0 ? kTextMutedW : kGreenW)
              }
            }
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    .widgetURL(URL(string: "paceup://discover")!)
  }
}

// MARK: - Entry view dispatcher

struct PaceUpWidgetEntryView: View {
  @Environment(\\.widgetFamily) var family
  let entry: PaceUpWidgetEntry
  var body: some View {
    Group {
      if family == .systemMedium {
        PaceUpMediumView(e: entry)
      } else {
        PaceUpSmallView(e: entry)
      }
    }
  }
}

// Subtle top-to-bottom dark-green gradient background — gives depth vs. flat fill
private struct WidgetBackground: View {
  var body: some View {
    LinearGradient(
      colors: [kBgWTop, kBgW],
      startPoint: .top,
      endPoint: .bottom
    )
  }
}

// MARK: - Home Screen Widget

struct PaceUpWidget: Widget {
  let kind = "PaceUpWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: PaceUpWidgetProvider()) { entry in
      if #available(iOS 17.0, *) {
        PaceUpWidgetEntryView(entry: entry)
          .containerBackground(for: .widget) { WidgetBackground() }
      } else {
        ZStack {
          WidgetBackground()
          PaceUpWidgetEntryView(entry: entry)
            .padding(14)
        }
      }
    }
    .configurationDisplayName("PaceUp")
    .description("Your next run, streak, and weekly goal progress.")
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
