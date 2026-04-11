export const darkColors = {
  bg: "#000000",
  surface: "#0F0F0F",
  card: "#1A1A1A",
  cardHighlight: "#222222",
  primary: "#00D97E",
  primaryDark: "#00A85E",
  primaryMuted: "#00D97E22",
  text: "#F0FFF4",
  textSecondary: "#8FAF97",
  textMuted: "#4A6957",
  orange: "#FF6B35",
  blue: "#4DA6FF",
  gold: "#FFB800",
  danger: "#FF4444",
  border: "#1F1F1F",
  borderLight: "#2A2A2A",
  overlay: "rgba(0, 0, 0, 0.88)",
  white: "#FFFFFF",
  tabBar: "#000000",
  tint: "#00D97E",
  tabIconDefault: "#4A6957",
  tabIconSelected: "#00D97E",
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
  white: "#0A1F12",
  tabBar: "#FFFFFF",
  tint: "#00A85E",
  tabIconDefault: "#8AAD99",
  tabIconSelected: "#00A85E",
};

export type ColorScheme = typeof darkColors;

const C = lightColors;

export default C;
