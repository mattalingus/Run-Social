import SwiftUI

struct SummaryView: View {
    @EnvironmentObject var workout: WorkoutManager
    @EnvironmentObject var phone: PhoneConnector

    @State private var uploading = false
    @State private var resultMessage: String?
    @State private var didSave = false

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                // Header
                VStack(spacing: 4) {
                    Image(systemName: workout.activity.glyph)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(Theme.green)
                    Text(workout.activity.title.uppercased())
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .tracking(1.4)
                        .foregroundColor(Theme.green)
                    Text("COMPLETE")
                        .font(.system(size: 9, weight: .heavy, design: .rounded))
                        .tracking(1.2)
                        .foregroundColor(Theme.textMuted)
                }
                .padding(.top, 4)

                // Hero: elapsed
                VStack(spacing: 2) {
                    Text(Fmt.elapsed(workout.elapsed))
                        .font(.system(size: 32, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundColor(Theme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text("ELAPSED")
                        .font(.system(size: 9, weight: .heavy, design: .rounded))
                        .tracking(0.8)
                        .foregroundColor(Theme.textMuted)
                }

                // Stats grid
                HStack(spacing: 6) {
                    SummaryStat(
                        label: "DISTANCE",
                        value: Fmt.distance(meters: workout.distanceMeters, unit: workout.distanceUnit),
                        unit: workout.distanceUnit.label
                    )
                    SummaryStat(
                        label: workout.activity.isSpeedBased ? "AVG SPD" : "AVG PACE",
                        value: workout.activity.isSpeedBased
                            ? Fmt.speed(metersPerSecond: workout.avgSpeedMps, unit: workout.distanceUnit)
                            : Fmt.pace(metersPerSecond: workout.avgSpeedMps, unit: workout.distanceUnit),
                        unit: workout.activity.isSpeedBased
                            ? (workout.distanceUnit == .mi ? "MPH" : "KM/H")
                            : (workout.distanceUnit == .mi ? "/MI" : "/KM")
                    )
                }
                HStack(spacing: 6) {
                    SummaryStat(label: "CALORIES", value: Fmt.kcal(workout.calories), unit: "KCAL")
                    SummaryStat(label: "AVG HR", value: Fmt.bpm(workout.heartRate), unit: "BPM")
                }

                if let msg = resultMessage {
                    Text(msg)
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundColor(didSave ? Theme.green : Theme.amber)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity)
                        .background(Theme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }

                // Save button
                Button {
                    Task { await save() }
                } label: {
                    HStack(spacing: 6) {
                        if uploading {
                            ProgressView().tint(Theme.bg)
                        } else {
                            Image(systemName: didSave ? "checkmark" : "arrow.up.circle.fill")
                        }
                        Text(didSave ? "Saved" : "Save to PaceUp")
                    }
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .foregroundColor(Theme.bg)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .background(didSave ? Theme.greenDim : Theme.green)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(uploading || didSave)

                // Discard
                Button {
                    workout.reset()
                } label: {
                    Text("Done")
                        .font(.system(size: 12, weight: .heavy, design: .rounded))
                        .foregroundColor(Theme.textDim)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 6)
        }
        .background(Theme.bg.ignoresSafeArea())
    }

    private func save() async {
        uploading = true
        let result = await Uploader.shared.uploadRun(
            activity: workout.activity,
            distanceMeters: workout.distanceMeters,
            elapsedSeconds: workout.elapsed,
            route: workout.route,
            avgHeartRate: workout.heartRate,
            calories: workout.calories,
            distanceUnit: workout.distanceUnit
        )
        uploading = false
        resultMessage = result.message
        didSave = result.success || true // show "saved" regardless (either uploaded or stashed)
    }
}

private struct SummaryStat: View {
    let label: String
    let value: String
    let unit: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 8, weight: .heavy, design: .rounded))
                .tracking(0.8)
                .foregroundColor(Theme.textMuted)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(.system(size: 16, weight: .heavy, design: .rounded))
                    .foregroundColor(Theme.text)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(unit)
                    .font(.system(size: 8, weight: .heavy, design: .rounded))
                    .tracking(0.6)
                    .foregroundColor(Theme.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        )
    }
}
