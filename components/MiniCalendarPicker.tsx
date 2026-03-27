import React, { useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";

interface Props {
  value: Date;
  onChange: (date: Date) => void;
  minDate?: Date;
  maxDate?: Date;
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildGrid(year: number, month: number): (number | null)[][] {
  const firstDow = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

type TriggerLayout = { x: number; y: number; width: number; height: number };

export default function MiniCalendarPicker({ value, onChange, minDate, maxDate }: Props) {
  const { C } = useTheme();
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());
  const [triggerLayout, setTriggerLayout] = useState<TriggerLayout | null>(null);
  const triggerRef = useRef<View>(null);

  const today = useMemo(() => new Date(), []);

  const formattedValue = useMemo(
    () => value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    [value]
  );

  const grid = useMemo(() => buildGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  function openCalendar() {
    if (triggerRef.current) {
      triggerRef.current.measureInWindow((x, y, width, height) => {
        setTriggerLayout({ x, y, width, height });
        setViewYear(value.getFullYear());
        setViewMonth(value.getMonth());
        setOpen(true);
      });
    }
  }

  function close() {
    setOpen(false);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  function selectDay(day: number) {
    onChange(new Date(viewYear, viewMonth, day));
    close();
  }

  const calendarWidth = triggerLayout ? Math.max(triggerLayout.width, 260) : 280;
  const calendarTop = triggerLayout
    ? triggerLayout.y + triggerLayout.height + 4
    : 0;
  const calendarLeft = triggerLayout ? triggerLayout.x : 0;

  const s = useMemo(
    () =>
      StyleSheet.create({
        trigger: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: open ? C.primary : C.border,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 13,
        },
        triggerText: {
          fontFamily: "Outfit_400Regular",
          fontSize: 15,
          color: C.text,
        },
        backdrop: {
          flex: 1,
          backgroundColor: "transparent",
        },
        calendar: {
          position: "absolute",
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 12,
          paddingHorizontal: 10,
          paddingVertical: 12,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 8,
          elevation: 8,
        },
        monthHeader: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
          paddingHorizontal: 2,
        },
        monthTitle: {
          fontFamily: "Outfit_600SemiBold",
          fontSize: 15,
          color: C.text,
        },
        dayHeaderRow: {
          flexDirection: "row",
          marginBottom: 4,
        },
        dayHeaderCell: {
          flex: 1,
          alignItems: "center",
          paddingVertical: 2,
        },
        dayHeaderText: {
          fontFamily: "Outfit_600SemiBold",
          fontSize: 11,
          color: C.textMuted,
        },
        row: {
          flexDirection: "row",
          marginBottom: 2,
        },
        cell: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 3,
        },
        circle: {
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: "center",
          justifyContent: "center",
        },
      }),
    [C, open]
  );

  return (
    <View>
      <View ref={triggerRef}>
        <Pressable style={s.trigger} onPress={open ? close : openCalendar}>
          <Text style={s.triggerText}>{formattedValue}</Text>
          <Feather
            name={open ? "chevron-up" : "calendar"}
            size={16}
            color={open ? C.primary : C.textMuted}
          />
        </Pressable>
      </View>

      <Modal
        visible={open}
        transparent
        animationType="none"
        onRequestClose={close}
        statusBarTranslucent
      >
        <TouchableWithoutFeedback onPress={close}>
          <View style={s.backdrop}>
            {triggerLayout != null && (
              <TouchableWithoutFeedback onPress={() => {}}>
                <View
                  style={[
                    s.calendar,
                    {
                      top: calendarTop,
                      left: calendarLeft,
                      width: calendarWidth,
                    },
                  ]}
                >
                  <View style={s.monthHeader}>
                    <Pressable onPress={prevMonth} hitSlop={10} style={{ padding: 4 }}>
                      <Feather name="chevron-left" size={20} color={C.text} />
                    </Pressable>
                    <Text style={s.monthTitle}>
                      {MONTH_NAMES[viewMonth]} {viewYear}
                    </Text>
                    <Pressable onPress={nextMonth} hitSlop={10} style={{ padding: 4 }}>
                      <Feather name="chevron-right" size={20} color={C.text} />
                    </Pressable>
                  </View>

                  <View style={s.dayHeaderRow}>
                    {DAY_LABELS.map((d, i) => (
                      <View key={i} style={s.dayHeaderCell}>
                        <Text style={s.dayHeaderText}>{d}</Text>
                      </View>
                    ))}
                  </View>

                  {grid.map((row, ri) => (
                    <View key={ri} style={s.row}>
                      {row.map((day, ci) => {
                        if (day === null) return <View key={ci} style={s.cell} />;
                        const cellDate = new Date(viewYear, viewMonth, day);
                        const isToday = sameDay(cellDate, today);
                        const isSelected = sameDay(cellDate, value);
                        const isDisabled =
                          (minDate != null && cellDate < minDate) ||
                          (maxDate != null && cellDate > maxDate);

                        return (
                          <Pressable
                            key={ci}
                            style={s.cell}
                            onPress={() => !isDisabled && selectDay(day)}
                            disabled={!!isDisabled}
                          >
                            <View
                              style={[
                                s.circle,
                                isSelected && { backgroundColor: "#00D97E" },
                                !isSelected && isToday && {
                                  backgroundColor: "rgba(0,217,126,0.15)",
                                },
                              ]}
                            >
                              <Text
                                style={{
                                  fontFamily:
                                    isSelected || isToday
                                      ? "Outfit_600SemiBold"
                                      : "Outfit_400Regular",
                                  fontSize: 14,
                                  color: isSelected
                                    ? "#050C09"
                                    : isToday
                                    ? "#00D97E"
                                    : isDisabled
                                    ? C.textMuted
                                    : C.text,
                                }}
                              >
                                {day}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </TouchableWithoutFeedback>
            )}
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}
