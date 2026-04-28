import SwiftUI

/// The live workout screen — TabView with 3 pages: metrics, map stats, controls.
/// Auto-locks via Watch OS water-lock-style feature isn't used; instead we rely
/// on the system "Wrist Raise" behavior and a large-target Pause button.
struct ActiveView: View {
    @EnvironmentObject var workout: WorkoutManager

    var body: some View {
        TabView {
            metricsPage.tag(0)
            extraPage.tag(1)
            controlsPage.tag(2)
        }
        .tabViewStyle(.page)
        .background(Theme.bg.ignoresSafeArea())
    }

    // MARK: - Page 1: headline metrics

    private var metricsPage: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Top chip row
            HStack(spacing: 6) {
                ActivityChip(kind: workout.activity)
                Spacer()
                LiveDot()
            }

            // Elapsed — hero
            Text(Fmt.elapsed(workout.elapsed))
                .font(.system(size: 38, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundColor(Theme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.6)

            // Distance
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(Fmt.distance(meters: workout.distanceMeters, unit: workout.distanceUnit))
                    .font(.system(size: 26, weight: .heavy, design: .rounded))
                    .foregroundColor(Theme.text)
                    .monospacedDigit()
                Text(workout.distanceUnit.label)
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .tracking(0.8)
                    .foregroundColor(Theme.textDim)
            }

            // Pace or speed row + HR
            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(workout.activity.isSpeedBased
                         ? Fmt.speed(metersPerSecond: workout.speedMps, unit: workout.distanceUnit)
                         : Fmt.pace(metersPerSecond: workout.speedMps, unit: workout.distanceUnit))
                        .font(.system(size: 18, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundColor(Theme.green)
                    Text(paceLabel)
                        .font(.system(size: 8, weight: .heavy, design: .rounded))
                        .tracking(0.8)
                        .foregroundColor(Theme.textMuted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    HStack(spacing: 3) {
                        Image(systemName: "heart.fill")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.green)
                        Text(Fmt.bpm(workout.heartRate))
                            .font(.system(size: 18, weight: .heavy, design: .rounded))
                            .monospacedDigit()
                            .foregroundColor(Theme.text)
                    }
                    Text("BPM")
                        .font(.system(size: 8, weight: .heavy, design: .rounded))
                        .tracking(0.8)
                        .foregroundColor(Theme.textMuted)
                }
            }
            .padding(.top, 2)
        }
        .padding(.horizontal, 6)
        .padding(.top, 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: - Page 2: secondary stats

    private var extraPage: some View {
        VStack(spacing: 10) {
            HStack(spacing: 6) {
                Text("STATS")
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .tracking(1.2)
                    .foregroundColor(Theme.textMuted)
                Spacer()
                LiveDot()
            }
            .padding(.horizontal, 2)

            StatCard(label: "CALORIES", value: Fmt.kcal(workout.calories), accent: Theme.amber)
            StatCard(label: "AVG PACE",
                     value: workout.activity.isSpeedBased
                        ? Fmt.speed(metersPerSecond: workout.avgSpeedMps, unit: workout.distanceUnit)
                        : Fmt.pace(metersPerSecond: workout.avgSpeedMps, unit: workout.distanceUnit),
                     accent: Theme.green)
            StatCard(label: "GPS POINTS", value: "\(workout.route.count)", accent: Theme.textDim)
        }
        .padding(.horizontal, 6)
        .padding(.top, 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    // MARK: - Page 3: controls

    private var controlsPage: some View {
        VStack(spacing: 10) {
            Text("CONTROLS")
                .font(.system(size: 10, weight: .heavy, design: .rounded))
                .tracking(1.2)
                .foregroundColor(Theme.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                workout.pause()
            } label: {
                Label("Pause", systemImage: "pause.fill")
                    .font(.system(size: 16, weight: .heavy, design: .rounded))
                    .foregroundColor(Theme.bg)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.amber)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)

            Button {
                workout.finish()
            } label: {
                Label("End", systemImage: "stop.fill")
                    .font(.system(size: 16, weight: .heavy, design: .rounded))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.red)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 6)
        .padding(.top, 2)
    }

    private var paceLabel: String {
        if workout.activity.isSpeedBased {
            return workout.distanceUnit == .mi ? "MPH" : "KM/H"
        } else {
            return workout.distanceUnit == .mi ? "MIN/MI" : "MIN/KM"
        }
    }
}

// MARK: - Sub-components

private struct ActivityChip: View {
    let kind: ActivityKind
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: kind.glyph)
                .font(.system(size: 9, weight: .heavy))
                .foregroundColor(Theme.green)
            Text(kind.title.uppercased())
                .font(.system(size: 9, weight: .heavy, design: .rounded))
                .tracking(0.8)
                .foregroundColor(Theme.green)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Theme.greenSoft)
        .clipShape(Capsule())
    }
}

private struct LiveDot: View {
    @State private var on = true
    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(Theme.green)
                .frame(width: 6, height: 6)
                .opacity(on ? 1 : 0.3)
            Text("LIVE")
                .font(.system(size: 9, weight: .heavy, design: .rounded))
                .tracking(0.8)
                .foregroundColor(Theme.green)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
                on = false
            }
        }
    }
}

private struct StatCard: View {
    let label: String
    let value: String
    let accent: Color
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 9, weight: .heavy, design: .rounded))
                    .tracking(0.8)
                    .foregroundColor(Theme.textMuted)
                Text(value)
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .foregroundColor(accent)
                    .monospacedDigit()
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        )
    }
}
