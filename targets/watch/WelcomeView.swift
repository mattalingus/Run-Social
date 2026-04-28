import SwiftUI

struct WelcomeView: View {
    @EnvironmentObject var workout: WorkoutManager
    @EnvironmentObject var phone: PhoneConnector

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                // Brand header
                HStack(spacing: 6) {
                    Circle()
                        .fill(Theme.green)
                        .frame(width: 8, height: 8)
                    Text("PACEUP")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .tracking(1.4)
                        .foregroundColor(Theme.green)
                    Spacer()
                    if phone.rememberToken == nil {
                        Text("SIGN IN ON PHONE")
                            .font(.system(size: 8, weight: .semibold, design: .rounded))
                            .tracking(0.6)
                            .foregroundColor(Theme.amber)
                    }
                }
                .padding(.horizontal, 2)
                .padding(.top, 2)

                // Activity picker — 3 large tappable rows
                VStack(spacing: 6) {
                    ForEach(ActivityKind.allCases) { kind in
                        Button {
                            workout.activity = kind
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: kind.glyph)
                                    .font(.system(size: 18, weight: .semibold))
                                    .frame(width: 28)
                                    .foregroundColor(workout.activity == kind ? Theme.green : Theme.textDim)
                                Text(kind.title)
                                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                                    .foregroundColor(workout.activity == kind ? Theme.text : Theme.textDim)
                                Spacer()
                                if workout.activity == kind {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundColor(Theme.green)
                                        .font(.system(size: 16))
                                }
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(workout.activity == kind ? Theme.greenSoft : Theme.card)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(workout.activity == kind ? Theme.green : Theme.hairline, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }

                // Unit toggle
                HStack(spacing: 0) {
                    ForEach([DistanceUnit.mi, .km], id: \.self) { u in
                        Button {
                            workout.distanceUnit = u
                        } label: {
                            Text(u.label)
                                .font(.system(size: 11, weight: .bold, design: .rounded))
                                .tracking(0.8)
                                .foregroundColor(workout.distanceUnit == u ? Theme.bg : Theme.textDim)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 6)
                                .background(workout.distanceUnit == u ? Theme.green : Color.clear)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(3)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Theme.card)
                )

                // Start button — big green circle
                Button {
                    workout.beginCountdown()
                } label: {
                    ZStack {
                        Circle()
                            .fill(Theme.green)
                            .frame(width: 78, height: 78)
                            .shadow(color: Theme.green.opacity(0.45), radius: 10, y: 2)
                        VStack(spacing: 0) {
                            Image(systemName: "play.fill")
                                .font(.system(size: 22, weight: .bold))
                                .foregroundColor(Theme.bg)
                            Text("START")
                                .font(.system(size: 10, weight: .heavy, design: .rounded))
                                .tracking(1.2)
                                .foregroundColor(Theme.bg)
                        }
                    }
                }
                .buttonStyle(.plain)
                .padding(.top, 6)
            }
            .padding(.horizontal, 6)
        }
        .background(Theme.bg.ignoresSafeArea())
    }
}
