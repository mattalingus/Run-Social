import SwiftUI

@main
struct PaceUpWatchApp: App {
    @StateObject private var workout = WorkoutManager()
    @StateObject private var phone = PhoneConnector.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(workout)
                .environmentObject(phone)
                .onAppear {
                    // Seed distance unit from phone-pushed preference if available.
                    if workout.distanceUnit != phone.preferredUnit {
                        workout.distanceUnit = phone.preferredUnit
                    }
                }
        }
    }
}

/// Routes between the four screens based on `workout.phase`.
struct RootView: View {
    @EnvironmentObject var workout: WorkoutManager

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            switch workout.phase {
            case .idle:
                WelcomeView()
                    .transition(.opacity)
            case .countdown:
                CountdownView()
                    .transition(.opacity)
            case .active:
                ActiveView()
                    .transition(.opacity)
            case .paused:
                PausedView()
                    .transition(.opacity)
            case .finished:
                SummaryView()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: workout.phase)
    }
}
