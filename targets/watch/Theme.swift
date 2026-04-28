import SwiftUI

/// Brand tokens mirrored from the iOS app + Live Activity widget.
/// Keep these in lockstep with kGreen / kBg / kCard in the widget extension
/// so the watch feels like part of the same product.
enum Theme {
    static let green      = Color(red: 0.000, green: 0.851, blue: 0.494) // #00D97E
    static let greenSoft  = Color(red: 0.000, green: 0.851, blue: 0.494).opacity(0.18)
    static let greenDim   = Color(red: 0.000, green: 0.851, blue: 0.494).opacity(0.55)

    static let bg         = Color(red: 0.02,  green: 0.047, blue: 0.035) // near-black w/ green cast
    static let bgElev     = Color(red: 0.035, green: 0.067, blue: 0.052)
    static let card       = Color(red: 0.055, green: 0.094, blue: 0.071)

    static let text       = Color.white
    static let textDim    = Color.white.opacity(0.62)
    static let textMuted  = Color.white.opacity(0.38)

    static let amber      = Color(red: 1.0,   green: 0.72,  blue: 0.0)
    static let red        = Color(red: 1.0,   green: 0.35,  blue: 0.35)

    static let hairline   = Color.white.opacity(0.08)
}

/// A horizontal hairline divider matching the app's card dividers.
struct Hairline: View {
    var body: some View {
        Rectangle()
            .fill(Theme.hairline)
            .frame(height: 1)
    }
}

/// Vertical hairline (for stat rows).
struct VHairline: View {
    var body: some View {
        Rectangle()
            .fill(Theme.hairline)
            .frame(width: 1)
    }
}
