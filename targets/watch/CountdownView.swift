import SwiftUI

struct CountdownView: View {
    @EnvironmentObject var workout: WorkoutManager
    @State private var pulse: CGFloat = 0.85

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()

            Circle()
                .stroke(Theme.green.opacity(0.25), lineWidth: 3)
                .frame(width: 140, height: 140)
                .scaleEffect(pulse)
                .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: pulse)

            VStack(spacing: 4) {
                Text("\(max(1, workout.countdown))")
                    .font(.system(size: 84, weight: .heavy, design: .rounded))
                    .foregroundColor(Theme.green)
                    .contentTransition(.numericText())
                Text(workout.activity.title.uppercased())
                    .font(.system(size: 11, weight: .heavy, design: .rounded))
                    .tracking(1.4)
                    .foregroundColor(Theme.textDim)
            }
        }
        .onAppear { pulse = 1.05 }
    }
}
