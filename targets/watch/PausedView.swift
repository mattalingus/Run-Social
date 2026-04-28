import SwiftUI

struct PausedView: View {
    @EnvironmentObject var workout: WorkoutManager

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                HStack(spacing: 5) {
                    Circle().fill(Theme.amber).frame(width: 7, height: 7)
                    Text("PAUSED")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .tracking(1.2)
                        .foregroundColor(Theme.amber)
                    Spacer()
                }

                Text(Fmt.elapsed(workout.elapsed))
                    .font(.system(size: 34, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(Theme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)

                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(Fmt.distance(meters: workout.distanceMeters, unit: workout.distanceUnit))
                        .font(.system(size: 22, weight: .heavy, design: .rounded))
                        .foregroundColor(Theme.textDim)
                    Text(workout.distanceUnit.label)
                        .font(.system(size: 10, weight: .heavy, design: .rounded))
                        .tracking(0.8)
                        .foregroundColor(Theme.textMuted)
                    Spacer()
                }

                Button {
                    workout.resume()
                } label: {
                    Label("Resume", systemImage: "play.fill")
                        .font(.system(size: 16, weight: .heavy, design: .rounded))
                        .foregroundColor(Theme.bg)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Theme.green)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)

                Button {
                    workout.finish()
                } label: {
                    Label("End workout", systemImage: "stop.fill")
                        .font(.system(size: 14, weight: .heavy, design: .rounded))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Theme.red.opacity(0.85))
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 8)
            .padding(.top, 4)
        }
        .background(Theme.bg.ignoresSafeArea())
    }
}
