import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { darkColors as C } from "@/constants/colors";
import { toDisplayDist, type DistanceUnit } from "@/lib/units";

type Period = "W" | "M" | "6M" | "Y";

export interface ActivityDataPoint {
  date: string;
  distance_miles: number;
  duration_seconds: number | null;
  move_time_seconds?: number | null;
  elevation_gain_ft: number | null;
  activity_type: string;
  completed?: boolean;
}

interface BarItem {
  label: string;
  value: number;
  isToday: boolean;
}

const PERIOD_LABELS: Record<Period, string> = {
  W: "This Week",
  M: "This Month",
  "6M": "Last 6 Months",
  Y: "This Year",
};

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function getPeriodBars(
  activities: ActivityDataPoint[],
  activityType: string,
  period: Period
): BarItem[] {
  const filtered = activities.filter(
    (a) => (a.activity_type ?? "run") === activityType && a.completed !== false
  );
  const now = new Date();

  if (period === "W") {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      const label = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
      const key = dayKey(d);
      const total = filtered
        .filter((a) => dayKey(new Date(a.date)) === key)
        .reduce((s, a) => s + a.distance_miles, 0);
      return { label, value: total, isToday: i === 6 };
    });
  }

  if (period === "M") {
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const key = `${year}-${month}-${day}`;
      const total = filtered
        .filter((a) => {
          const ad = new Date(a.date);
          return `${ad.getFullYear()}-${ad.getMonth()}-${ad.getDate()}` === key;
        })
        .reduce((s, a) => s + a.distance_miles, 0);
      return {
        label: day % 7 === 1 ? String(day) : "",
        value: total,
        isToday: day === now.getDate(),
      };
    });
  }

  if (period === "6M") {
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const label = d.toLocaleString("en-US", { month: "short" });
      const total = filtered
        .filter((a) => {
          const ad = new Date(a.date);
          return ad.getFullYear() === y && ad.getMonth() === m;
        })
        .reduce((s, a) => s + a.distance_miles, 0);
      return { label, value: total, isToday: i === 5 };
    });
  }

  const year = now.getFullYear();
  return Array.from({ length: 12 }, (_, m) => {
    const label = new Date(year, m, 1).toLocaleString("en-US", { month: "short" });
    const total = filtered
      .filter((a) => {
        const ad = new Date(a.date);
        return ad.getFullYear() === year && ad.getMonth() === m;
      })
      .reduce((s, a) => s + a.distance_miles, 0);
    return { label, value: total, isToday: m === now.getMonth() };
  });
}

function getPeriodStats(
  activities: ActivityDataPoint[],
  activityType: string,
  period: Period
): { distance: number; duration: number; elevation: number } {
  const filtered = activities.filter(
    (a) => (a.activity_type ?? "run") === activityType && a.completed !== false
  );
  const now = new Date();
  let subset: ActivityDataPoint[];

  if (period === "W") {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 6);
    cutoff.setHours(0, 0, 0, 0);
    subset = filtered.filter((a) => new Date(a.date) >= cutoff);
  } else if (period === "M") {
    subset = filtered.filter((a) => {
      const d = new Date(a.date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  } else if (period === "6M") {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    subset = filtered.filter((a) => new Date(a.date) >= cutoff);
  } else {
    subset = filtered.filter((a) => new Date(a.date).getFullYear() === now.getFullYear());
  }

  const distance = subset.reduce((s, a) => s + a.distance_miles, 0);
  const duration = subset.reduce((s, a) => s + ((a as any).move_time_seconds ?? a.duration_seconds ?? 0), 0);
  const elevation = subset.reduce((s, a) => s + (a.elevation_gain_ft ?? 0), 0);
  return { distance, duration, elevation };
}

function calcStreak(activities: ActivityDataPoint[], activityType: string): number {
  const activeDays = new Set<string>();
  activities
    .filter((a) => (a.activity_type ?? "run") === activityType && a.completed !== false)
    .forEach((a) => {
      const d = new Date(a.date);
      activeDays.add(dayKey(d));
    });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let streak = 0;
  const check = new Date(today);

  while (activeDays.has(dayKey(check))) {
    streak++;
    check.setDate(check.getDate() - 1);
  }
  return streak;
}

const MAX_BAR_HEIGHT = 100;

function ChartBars({
  bars,
  distUnit,
  period,
  periodTotal,
}: {
  bars: BarItem[];
  distUnit: DistanceUnit;
  period: Period;
  periodTotal: number;
}) {
  const maxVal = Math.max(...bars.map((b) => b.value), 0.01);
  const barWidth = period === "M" ? 8 : period === "W" ? 36 : period === "6M" ? 44 : 22;
  const barGap = period === "M" ? 2 : period === "W" ? 6 : 8;

  const barsContent = (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      {bars.map((bar, idx) => {
        const heightPct = bar.value / maxVal;
        const barH = Math.max(heightPct * MAX_BAR_HEIGHT, bar.value > 0 ? 3 : 0);
        return (
          <View
            key={idx}
            style={{ width: barWidth, marginRight: idx < bars.length - 1 ? barGap : 0, alignItems: "center" }}
          >
            <View style={{ width: barWidth, height: MAX_BAR_HEIGHT, justifyContent: "flex-end" }}>
              <View
                style={{
                  width: barWidth,
                  height: barH || 2,
                  backgroundColor:
                    bar.value > 0
                      ? bar.isToday
                        ? C.primary
                        : C.primary + "BB"
                      : C.border + "55",
                  borderRadius: 3,
                  opacity: bar.value > 0 ? 1 : 0.4,
                }}
              />
            </View>
            <Text
              style={{
                fontFamily: "Outfit_400Regular",
                fontSize: period === "M" ? 9 : 11,
                color: bar.isToday ? C.primary : C.textMuted,
                marginTop: 4,
                textAlign: "center",
                height: period === "M" ? 13 : 16,
              }}
            >
              {bar.label}
            </Text>
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 6 }}>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={s.totalNum}>{toDisplayDist(periodTotal, distUnit)}</Text>
          <Text style={s.totalLabel}>{PERIOD_LABELS[period]}</Text>
        </View>
      </View>
      {bars.length > 14 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {barsContent}
        </ScrollView>
      ) : (
        barsContent
      )}
    </View>
  );
}

function ActivityCalendar({
  activities,
  activityType,
}: {
  activities: ActivityDataPoint[];
  activityType: string;
}) {
  const today = new Date();
  const [displayDate, setDisplayDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );

  const year = displayDate.getFullYear();
  const month = displayDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const isFutureMonth = displayDate > new Date(today.getFullYear(), today.getMonth(), 1);

  const activeDays = useMemo(() => {
    const set = new Set<number>();
    activities
      .filter((a) => (a.activity_type ?? "run") === activityType && a.completed !== false)
      .forEach((a) => {
        const d = new Date(a.date);
        if (d.getFullYear() === year && d.getMonth() === month) set.add(d.getDate());
      });
    return set;
  }, [activities, activityType, year, month]);

  const streak = useMemo(() => calcStreak(activities, activityType), [activities, activityType]);

  const firstDow = new Date(year, month, 1).getDay();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthLabel = displayDate.toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <View>
      <View style={s.calHeader}>
        <Text style={s.calMonthLabel}>{monthLabel}</Text>
        <View style={{ flexDirection: "row", gap: 4 }}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setDisplayDate(new Date(year, month - 1, 1));
            }}
            hitSlop={10}
            style={s.calNavBtn}
          >
            <Feather name="chevron-left" size={18} color={C.textMuted} />
          </Pressable>
          <Pressable
            onPress={() => {
              if (isFutureMonth) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setDisplayDate(new Date(year, month + 1, 1));
            }}
            hitSlop={10}
            style={[s.calNavBtn, { opacity: isFutureMonth ? 0.3 : 1 }]}
          >
            <Feather name="chevron-right" size={18} color={C.textMuted} />
          </Pressable>
        </View>
      </View>

      <View style={s.streakRow}>
        <View style={s.streakItem}>
          <Text style={s.streakLabel}>Current Streak</Text>
          <Text style={s.streakVal}>
            {streak} {streak === 1 ? "day" : "days"}
          </Text>
        </View>
        <View style={s.streakItem}>
          <Text style={s.streakLabel}>Active Days</Text>
          <Text style={s.streakVal}>{activeDays.size}</Text>
        </View>
      </View>

      <View style={s.calDowRow}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <View key={i} style={s.calDowCell}>
            <Text style={s.calDowTxt}>{d}</Text>
          </View>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={s.calWeekRow}>
          {week.map((day, di) => {
            if (day === null) return <View key={di} style={s.calDayCell} />;
            const isToday = isCurrentMonth && day === today.getDate();
            const isActive = activeDays.has(day);
            const isFuture = isCurrentMonth && day > today.getDate();
            return (
              <View key={di} style={s.calDayCell}>
                <View
                  style={[
                    s.calDayCircle,
                    isActive && { backgroundColor: C.primary },
                    isToday && !isActive && { borderWidth: 1.5, borderColor: C.primary },
                  ]}
                >
                  <Text
                    style={[
                      s.calDayTxt,
                      isActive && { color: C.bg, fontFamily: "Outfit_700Bold" },
                      isToday && !isActive && { color: C.primary, fontFamily: "Outfit_700Bold" },
                      isFuture && !isActive && { color: C.textMuted + "55" },
                    ]}
                  >
                    {day}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

interface ProfileChartsProps {
  activities: ActivityDataPoint[];
  activityType: string;
  distUnit: DistanceUnit;
}

export default function ProfileCharts({ activities, activityType, distUnit }: ProfileChartsProps) {
  const [period, setPeriod] = useState<Period>("W");

  const bars = useMemo(
    () => getPeriodBars(activities, activityType, period),
    [activities, activityType, period]
  );

  const stats = useMemo(
    () => getPeriodStats(activities, activityType, period),
    [activities, activityType, period]
  );

  return (
    <View style={s.wrapper}>
      <View style={s.card}>
        <View style={s.periodRow}>
          {(["W", "M", "6M", "Y"] as Period[]).map((p) => (
            <Pressable
              key={p}
              style={[s.periodBtn, period === p && s.periodBtnActive]}
              onPress={() => {
                setPeriod(p);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <Text style={[s.periodTxt, period === p && s.periodTxtActive]}>{p}</Text>
            </Pressable>
          ))}
        </View>

        <ChartBars bars={bars} distUnit={distUnit} period={period} periodTotal={stats.distance} />

        <View style={s.statsRow}>
          <View style={s.statItem}>
            <Text style={s.statVal}>{toDisplayDist(stats.distance, distUnit)}</Text>
            <Text style={s.statLabel}>Distance</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <Text style={s.statVal}>{stats.duration > 0 ? fmtDuration(stats.duration) : "—"}</Text>
            <Text style={s.statLabel}>Time</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <Text style={s.statVal}>
              {stats.elevation > 0 ? `${Math.round(stats.elevation).toLocaleString()} ft` : "—"}
            </Text>
            <Text style={s.statLabel}>Elev Gain</Text>
          </View>
        </View>
      </View>

      <View style={[s.card, { marginTop: 10 }]}>
        <ActivityCalendar activities={activities} activityType={activityType} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  periodRow: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: "center",
  },
  periodBtnActive: {
    backgroundColor: C.card,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  periodTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textMuted,
  },
  periodTxtActive: {
    fontFamily: "Outfit_700Bold",
    color: C.text,
  },
  totalNum: {
    fontFamily: "Outfit_700Bold",
    fontSize: 24,
    color: C.text,
    lineHeight: 28,
  },
  totalLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textMuted,
  },
  statsRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 12,
    marginTop: 10,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statVal: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: C.text,
  },
  statLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: C.border,
    marginVertical: 2,
  },
  calHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  calMonthLabel: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: C.text,
    flex: 1,
  },
  calNavBtn: {
    padding: 4,
  },
  streakRow: {
    flexDirection: "row",
    gap: 28,
    marginBottom: 14,
  },
  streakItem: {
    gap: 2,
  },
  streakLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textMuted,
  },
  streakVal: {
    fontFamily: "Outfit_700Bold",
    fontSize: 17,
    color: C.text,
  },
  calDowRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  calDowCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 2,
  },
  calDowTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.textMuted,
  },
  calWeekRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  calDayCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 3,
  },
  calDayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  calDayTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textMuted,
  },
});
