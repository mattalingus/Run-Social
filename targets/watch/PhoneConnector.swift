import Foundation
import WatchConnectivity

/// Bridges auth state + completed workouts to/from the paired iPhone.
///
/// Phone pushes `{ token, apiHost, userId, distanceUnit }` via
/// `updateApplicationContext` whenever the user signs in or a remember-token
/// refresh happens. We store the last context in UserDefaults so the watch can
/// run standalone even when the phone is out of reach.
@MainActor
final class PhoneConnector: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = PhoneConnector()

    @Published var apiHost: String = "https://paceup-backend-production.up.railway.app"
    @Published var rememberToken: String?
    @Published var userId: Int?
    @Published var preferredUnit: DistanceUnit = .mi
    @Published var isReachable: Bool = false

    private let defaults = UserDefaults(suiteName: "group.com.paceup.app") ?? .standard

    override init() {
        super.init()
        loadFromDefaults()
        activate()
    }

    private func activate() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        s.delegate = self
        s.activate()
    }

    private func loadFromDefaults() {
        if let h = defaults.string(forKey: "apiHost"), !h.isEmpty {
            apiHost = h
        }
        rememberToken = defaults.string(forKey: "rememberToken")
        let uid = defaults.integer(forKey: "userId")
        userId = uid > 0 ? uid : nil
        if let u = defaults.string(forKey: "distanceUnit"),
           let parsed = DistanceUnit(rawValue: u) {
            preferredUnit = parsed
        }
    }

    private func persist(_ ctx: [String: Any]) {
        if let h = ctx["apiHost"] as? String { defaults.set(h, forKey: "apiHost"); apiHost = h }
        if let t = ctx["token"] as? String { defaults.set(t, forKey: "rememberToken"); rememberToken = t }
        if let u = ctx["userId"] as? Int { defaults.set(u, forKey: "userId"); userId = u }
        if let unit = ctx["distanceUnit"] as? String,
           let parsed = DistanceUnit(rawValue: unit) {
            defaults.set(unit, forKey: "distanceUnit")
            preferredUnit = parsed
        }
    }

    // MARK: - Outbound

    /// Called after the watch completes and saves a run, so the phone can
    /// refresh its local cache / invalidate queries.
    func notifyPhoneRunCompleted(payload: [String: Any]) {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        guard s.activationState == .activated else { return }
        var msg = payload
        msg["kind"] = "watch.run.completed"
        if s.isReachable {
            s.sendMessage(msg, replyHandler: nil, errorHandler: nil)
        } else {
            try? s.updateApplicationContext(msg)
        }
    }

    // MARK: - WCSessionDelegate

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in
            self.isReachable = session.isReachable
            // On first activation, grab any context that was queued while the watch was asleep.
            let ctx = session.receivedApplicationContext
            if !ctx.isEmpty { self.persist(ctx) }
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in self.isReachable = session.isReachable }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String : Any]) {
        Task { @MainActor in self.persist(applicationContext) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String : Any]) {
        Task { @MainActor in self.persist(message) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String : Any], replyHandler: @escaping ([String : Any]) -> Void) {
        Task { @MainActor in
            self.persist(message)
            replyHandler(["ok": true])
        }
    }
}
