export const darkColors = {
  bg: "#0E0E0E",
  surface: "#121A16",
  card: "#18231E",
  cardHighlight: "#1F2D27",
  primary: "#00A85E",
  primaryDark: "#007A44",
  primaryMuted: "#00A85E22",
  text: "#ECF3EE",
  textSecondary: "#A2B9AB",
  textMuted: "#6B8479",
  orange: "#FF6B35",
  blue: "#5BB0FF",
  gold: "#FFB800",
  danger: "#FF5A5A",
  border: "#253029",
  borderLight: "#30403A",
  overlay: "rgba(8, 8, 8, 0.88)",
  white: "#FFFFFF",
  tabBar: "#0E0E0E",
  tint: "#00A85E",
  tabIconDefault: "#6B8479",
  tabIconSelected: "#00A85E",
};

export const lightColors = {
  bg: "#FFFFFF",
  surface: "#F4FAF6",
  card: "#E8F5EE",
  cardHighlight: "#DDF0E6",
  primary: "#00A85E",
  primaryDark: "#007A44",
  primaryMuted: "#00A85E22",
  text: "#0A1F12",
  textSecondary: "#3D6B50",
  textMuted: "#8AAD99",
  orange: "#FF6B35",
  blue: "#2A7ACC",
  gold: "#CC9000",
  danger: "#CC2222",
  border: "#C8E4D4",
  borderLight: "#B0D4C0",
  overlay: "rgba(255, 255, 255, 0.88)",
  white: "#FFFFFF",
  tabBar: "#FFFFFF",
  tint: "#00A85E",
  tabIconDefault: "#8AAD99",
  tabIconSelected: "#00A85E",
};

export type ColorScheme = typeof darkColors;

const C = lightColors;

export default C;
