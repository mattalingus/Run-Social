import Foundation

enum DistanceUnit: String {
    case mi
    case km

    var label: String { rawValue.uppercased() }
}

enum Fmt {
    // MARK: - Time

    /// HH:MM:SS if >=1h, MM:SS otherwise. No leading zero on the first segment.
    static func elapsed(_ seconds: TimeInterval) -> String {
        let s = max(0, Int(seconds))
        let h = s / 3600
        let m = (s % 3600) / 60
        let sec = s % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, sec)
        }
        return String(format: "%d:%02d", m, sec)
    }

    // MARK: - Distance

    /// Returns distance formatted for display with 2 decimals under 10, 1 decimal otherwise.
    static func distance(meters: Double, unit: DistanceUnit) -> String {
        let value = unit == .mi ? meters / 1609.344 : meters / 1000.0
        if value < 10 { return String(format: "%.2f", value) }
        return String(format: "%.1f", value)
    }

    // MARK: - Pace / Speed

    /// Pace in min/unit (min/mi or min/km) from m/s. Returns "—" for near-zero speed.
    static func pace(metersPerSecond v: Double, unit: DistanceUnit) -> String {
        guard v > 0.2 else { return "—" }
        let metersPerUnit: Double = unit == .mi ? 1609.344 : 1000.0
        let secPerUnit = metersPerUnit / v
        let m = Int(secPerUnit) / 60
        let s = Int(secPerUnit) % 60
        return String(format: "%d:%02d", m, s)
    }

    /// Speed in unit/hr (mph or km/h) from m/s — used for rides.
    static func speed(metersPerSecond v: Double, unit: DistanceUnit) -> String {
        let factor: Double = unit == .mi ? 2.2369362921 : 3.6
        let value = v * factor
        return String(format: "%.1f", value)
    }

    // MARK: - Heart rate / calories

    static func bpm(_ v: Double) -> String {
        guard v > 0 else { return "—" }
        return String(Int(v.rounded()))
    }

    static func kcal(_ v: Double) -> String {
        guard v > 0 else { return "0" }
        return String(Int(v.rounded()))
    }
}
