import { Platform, TextStyle } from "react-native";

const outfit = (weight: "400" | "500" | "600" | "700"): Pick<TextStyle, "fontFamily" | "fontWeight"> => {
  if (Platform.OS === "android") return { fontWeight: weight };
  const map: Record<string, string> = {
    "400": "Outfit_400Regular",
    "500": "Outfit_500Medium",
    "600": "Outfit_600SemiBold",
    "700": "Outfit_700Bold",
  };
  return { fontFamily: map[weight] };
};

export const type = {
  regular: (size: number, color?: string): TextStyle => ({ fontSize: size, ...outfit("400"), ...(color && { color }) }),
  medium:  (size: number, color?: string): TextStyle => ({ fontSize: size, ...outfit("500"), ...(color && { color }) }),
  semibold:(size: number, color?: string): TextStyle => ({ fontSize: size, ...outfit("600"), ...(color && { color }) }),
  bold:    (size: number, color?: string): TextStyle => ({ fontSize: size, ...outfit("700"), ...(color && { color }) }),
};

export const fontSize = {
  xs:   11,
  sm:   12,
  base: 13,
  md:   14,
  lg:   16,
  xl:   18,
  xxl:  22,
  display: 28,
} as const;
