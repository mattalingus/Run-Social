import Foundation
import CoreLocation

/// Uploads completed workouts to the PaceUp backend.
///
/// Flow:
/// 1. Exchange `rememberToken` for a session cookie via `/api/auth/restore-session`.
///    The cookie is stored in `HTTPCookieStorage.shared` and reused for step 2.
/// 2. POST the run payload to `/api/solo-runs` — same endpoint the phone uses.
///
/// If either step fails (offline, expired token, server down), the run is
/// persisted to the app group defaults as JSON so the phone can pick it up
/// on next sync.
@MainActor
final class Uploader {
    static let shared = Uploader()

    private let defaults = UserDefaults(suiteName: "group.com.paceup.app") ?? .standard
    private let session: URLSession

    init() {
        let cfg = URLSessionConfiguration.default
        cfg.httpCookieStorage = HTTPCookieStorage.shared
        cfg.httpShouldSetCookies = true
        cfg.httpCookieAcceptPolicy = .always
        cfg.timeoutIntervalForRequest = 20
        cfg.timeoutIntervalForResource = 45
        self.session = URLSession(configuration: cfg)
    }

    struct UploadResult {
        let success: Bool
        let message: String
    }

    /// Performs the full restore-session + solo-run upload. Returns a result
    /// the UI can surface in the summary screen.
    func uploadRun(
        activity: ActivityKind,
        distanceMeters: Double,
        elapsedSeconds: TimeInterval,
        route: [CLLocationCoordinate2D],
        avgHeartRate: Double,
        calories: Double,
        distanceUnit: DistanceUnit
    ) async -> UploadResult {
        let connector = PhoneConnector.shared
        let host = connector.apiHost.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let token = connector.rememberToken, !token.isEmpty else {
            stashForLaterSync(
                activity: activity,
                distanceMeters: distanceMeters,
                elapsedSeconds: elapsedSeconds,
                route: route,
                avgHeartRate: avgHeartRate,
                calories: calories,
                distanceUnit: distanceUnit
            )
            return UploadResult(success: false, message: "Saved on watch — will sync on iPhone.")
        }

        // Step 1: restore-session
        let restored = await restoreSession(host: host, token: token)
        guard restored else {
            stashForLaterSync(
                activity: activity,
                distanceMeters: distanceMeters,
                elapsedSeconds: elapsedSeconds,
                route: route,
                avgHeartRate: avgHeartRate,
                calories: calories,
                distanceUnit: distanceUnit
            )
            return UploadResult(success: false, message: "Saved — sign in on iPhone to sync.")
        }

        // Step 2: solo-runs
        let miles = distanceMeters / 1609.344
        let paceMinPerMile: Double = miles > 0.01 ? (elapsedSeconds / 60.0) / miles : 0

        var payload: [String: Any] = [
            "activity_type": activity.rawValue,
            "distance_miles": miles,
            "duration_seconds": Int(elapsedSeconds),
            "pace_min_per_mile": paceMinPerMile,
            "source": "watch",
            "distance_unit": distanceUnit.rawValue,
        ]
        if avgHeartRate > 0 { payload["avg_heart_rate"] = Int(avgHeartRate.rounded()) }
        if calories > 0 { payload["calories"] = Int(calories.rounded()) }
        if !route.isEmpty {
            payload["route"] = route.map { ["lat": $0.latitude, "lon": $0.longitude] }
        }

        do {
            let url = URL(string: host + "/api/solo-runs")!
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (_, resp) = try await session.data(for: req)
            if let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                return UploadResult(success: true, message: "Synced to iPhone")
            }
        } catch {
            // fall through
        }

        stashForLaterSync(
            activity: activity,
            distanceMeters: distanceMeters,
            elapsedSeconds: elapsedSeconds,
            route: route,
            avgHeartRate: avgHeartRate,
            calories: calories,
            distanceUnit: distanceUnit
        )
        return UploadResult(success: false, message: "Saved — will retry sync.")
    }

    // MARK: - Restore session

    private func restoreSession(host: String, token: String) async -> Bool {
        do {
            let url = URL(string: host + "/api/auth/restore-session")!
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let body = try JSONSerialization.data(withJSONObject: ["token": token])
            req.httpBody = body
            let (_, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else { return false }
            return (200..<300).contains(http.statusCode)
        } catch {
            return false
        }
    }

    // MARK: - Offline stash

    private func stashForLaterSync(
        activity: ActivityKind,
        distanceMeters: Double,
        elapsedSeconds: TimeInterval,
        route: [CLLocationCoordinate2D],
        avgHeartRate: Double,
        calories: Double,
        distanceUnit: DistanceUnit
    ) {
        let runs = (defaults.array(forKey: "pendingRuns") as? [[String: Any]]) ?? []
        let entry: [String: Any] = [
            "activity": activity.rawValue,
            "distance_meters": distanceMeters,
            "duration_seconds": Int(elapsedSeconds),
            "avg_heart_rate": avgHeartRate,
            "calories": calories,
            "distance_unit": distanceUnit.rawValue,
            "route": route.map { ["lat": $0.latitude, "lon": $0.longitude] },
            "captured_at": ISO8601DateFormatter().string(from: Date()),
        ]
        var next = runs
        next.append(entry)
        defaults.set(next, forKey: "pendingRuns")

        // Nudge the phone so it knows there's pending data.
        PhoneConnector.shared.notifyPhoneRunCompleted(payload: [
            "activity": activity.rawValue,
            "distance_meters": distanceMeters,
            "duration_seconds": Int(elapsedSeconds),
        ])
    }
}
