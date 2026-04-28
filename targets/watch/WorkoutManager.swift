import Foundation
import HealthKit
import CoreLocation
import SwiftUI
import Combine

// MARK: - Activity type

enum ActivityKind: String, CaseIterable, Identifiable {
    case run, ride, walk

    var id: String { rawValue }

    var title: String {
        switch self {
        case .run:  return "Run"
        case .ride: return "Ride"
        case .walk: return "Walk"
        }
    }

    var glyph: String {
        switch self {
        case .run:  return "figure.run"
        case .ride: return "bicycle"
        case .walk: return "figure.walk"
        }
    }

    var hkActivity: HKWorkoutActivityType {
        switch self {
        case .run:  return .running
        case .ride: return .cycling
        case .walk: return .walking
        }
    }

    var isSpeedBased: Bool { self == .ride }
}

// MARK: - Workout phase

enum WorkoutPhase: Equatable {
    case idle
    case countdown
    case active
    case paused
    case finished
}

// MARK: - Workout manager
//
// Owns an HKWorkoutSession + HKLiveWorkoutBuilder for heart rate / calories,
// and a CLLocationManager for GPS (distance + route polyline).
//
// We derive distance from GPS ourselves rather than relying on
// HKQuantityTypeIdentifier.distanceWalkingRunning because we want the route
// coordinates server-side and we want identical numbers on phone + watch.

@MainActor
final class WorkoutManager: NSObject, ObservableObject {

    // ── Configuration ────────────────────────────────────────────────
    @Published var activity: ActivityKind = .run
    @Published var distanceUnit: DistanceUnit = .mi

    // ── Live state ───────────────────────────────────────────────────
    @Published var phase: WorkoutPhase = .idle
    @Published var countdown: Int = 3

    /// Accumulated wall-clock time while in `.active` (excludes pauses).
    @Published var elapsed: TimeInterval = 0
    /// Meters travelled (filtered GPS).
    @Published var distanceMeters: Double = 0
    /// Instantaneous speed m/s (smoothed over last few samples).
    @Published var speedMps: Double = 0
    /// Heart rate bpm, latest sample.
    @Published var heartRate: Double = 0
    /// Active kcal from HealthKit.
    @Published var calories: Double = 0

    /// Route polyline (lat, lon) in capture order.
    @Published var route: [CLLocationCoordinate2D] = []

    // ── Private ──────────────────────────────────────────────────────
    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private let locationManager = CLLocationManager()
    private var lastLocation: CLLocation?
    private var startedAt: Date?
    private var pausedAt: Date?
    private var tickTimer: Timer?
    private var speedSamples: [Double] = []

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.activityType = .fitness
        locationManager.distanceFilter = 3 // meters
        // Requires "location" in WKBackgroundModes — only set when entitlement is present
        // to avoid crash on watchOS simulator. Safe to skip; background updates are
        // only needed during an active workout session anyway.
        if Bundle.main.object(forInfoDictionaryKey: "WKBackgroundModes") is [String],
           (Bundle.main.object(forInfoDictionaryKey: "WKBackgroundModes") as? [String])?.contains("location") == true {
            locationManager.allowsBackgroundLocationUpdates = true
        }
    }

    // MARK: - Permissions

    func requestPermissions() async {
        // HealthKit
        let toShare: Set<HKSampleType> = [HKObjectType.workoutType()]
        let toRead: Set<HKObjectType> = [
            HKObjectType.quantityType(forIdentifier: .heartRate)!,
            HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!,
            HKObjectType.workoutType(),
        ]
        do {
            try await healthStore.requestAuthorization(toShare: toShare, read: toRead)
        } catch {
            // Fall through — HealthKit is optional; GPS is our source of truth.
        }
        // Location
        locationManager.requestWhenInUseAuthorization()
    }

    // MARK: - Lifecycle

    func beginCountdown() {
        guard phase == .idle else { return }
        phase = .countdown
        countdown = 3
        Task {
            await requestPermissions()
        }
        scheduleCountdown()
    }

    private func scheduleCountdown() {
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] t in
            Task { @MainActor in
                guard let self else { t.invalidate(); return }
                if self.phase != .countdown { t.invalidate(); return }
                self.countdown -= 1
                if self.countdown <= 0 {
                    t.invalidate()
                    self.start()
                }
            }
        }
    }

    func start() {
        guard phase != .active else { return }
        phase = .active
        startedAt = Date()
        elapsed = 0
        distanceMeters = 0
        heartRate = 0
        calories = 0
        route.removeAll()
        speedSamples.removeAll()
        startHealthKit()
        locationManager.startUpdatingLocation()
        startTick()
    }

    func pause() {
        guard phase == .active else { return }
        phase = .paused
        pausedAt = Date()
        session?.pause()
        locationManager.stopUpdatingLocation()
        stopTick()
    }

    func resume() {
        guard phase == .paused else { return }
        if let p = pausedAt, let s = startedAt {
            // Shift startedAt forward by pause duration so elapsed math stays clean.
            let gap = Date().timeIntervalSince(p)
            startedAt = s.addingTimeInterval(gap)
        }
        pausedAt = nil
        phase = .active
        session?.resume()
        locationManager.startUpdatingLocation()
        startTick()
    }

    func finish() {
        phase = .finished
        stopTick()
        locationManager.stopUpdatingLocation()
        if let builder {
            builder.endCollection(withEnd: Date()) { _, _ in
                builder.finishWorkout { _, _ in }
            }
        }
        session?.end()
    }

    func reset() {
        phase = .idle
        session = nil
        builder = nil
        startedAt = nil
        pausedAt = nil
        elapsed = 0
        distanceMeters = 0
        heartRate = 0
        calories = 0
        speedMps = 0
        route.removeAll()
        speedSamples.removeAll()
    }

    // MARK: - HealthKit session

    private func startHealthKit() {
        let config = HKWorkoutConfiguration()
        config.activityType = activity.hkActivity
        config.locationType = .outdoor

        do {
            let s = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let b = s.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)
            s.delegate = self
            b.delegate = self
            session = s
            builder = b
            let start = Date()
            s.startActivity(with: start)
            b.beginCollection(withStart: start) { _, _ in }
        } catch {
            // Non-fatal — GPS still works.
        }
    }

    // MARK: - Timer (UI tick)

    private func startTick() {
        stopTick()
        tickTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let start = self.startedAt, self.phase == .active else { return }
                self.elapsed = Date().timeIntervalSince(start)
            }
        }
        RunLoop.main.add(tickTimer!, forMode: .common)
    }

    private func stopTick() {
        tickTimer?.invalidate()
        tickTimer = nil
    }

    // MARK: - Derived

    /// Average m/s over the full active window (stable number for UI).
    var avgSpeedMps: Double {
        guard elapsed > 1 else { return 0 }
        return distanceMeters / elapsed
    }
}

// MARK: - CLLocationManagerDelegate

extension WorkoutManager: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            for loc in locations {
                // Reject stale or low-accuracy fixes.
                guard loc.horizontalAccuracy > 0, loc.horizontalAccuracy < 35 else { continue }
                guard loc.timestamp.timeIntervalSinceNow > -3 else { continue }

                if let prev = self.lastLocation {
                    let delta = loc.distance(from: prev)
                    if delta > 0 && delta < 80 { // reject teleports
                        self.distanceMeters += delta
                    }
                }
                self.lastLocation = loc

                // Smooth speed over last 4 samples.
                let s = max(0, loc.speed)
                self.speedSamples.append(s)
                if self.speedSamples.count > 4 { self.speedSamples.removeFirst() }
                self.speedMps = self.speedSamples.reduce(0, +) / Double(self.speedSamples.count)

                self.route.append(loc.coordinate)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Silent — GPS hiccups are common, UI already shows no-signal state.
    }
}

// MARK: - HKWorkoutSessionDelegate

extension WorkoutManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) { /* no-op: we drive phase from UI */ }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) { }
}

// MARK: - HKLiveWorkoutBuilderDelegate

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) { }

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        for type in collectedTypes {
            guard let q = type as? HKQuantityType else { continue }
            if q == HKQuantityType.quantityType(forIdentifier: .heartRate) {
                if let stats = workoutBuilder.statistics(for: q),
                   let m = stats.mostRecentQuantity() {
                    let v = m.doubleValue(for: HKUnit(from: "count/min"))
                    Task { @MainActor in self.heartRate = v }
                }
            } else if q == HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
                if let stats = workoutBuilder.statistics(for: q),
                   let sum = stats.sumQuantity() {
                    let v = sum.doubleValue(for: .kilocalorie())
                    Task { @MainActor in self.calories = v }
                }
            }
        }
    }
}
