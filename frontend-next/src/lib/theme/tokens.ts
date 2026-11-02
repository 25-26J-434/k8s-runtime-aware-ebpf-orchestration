export type Mode = "light" | "dark";

/** Colour and layout constants. Components read colour through antd's theme tokens, not from here. */
export const status = {
  success: "#3f9d5f",
  warning: "#d08a1f",
  critical: "#d1453b",
  info: "#4a7fc1",
} as const;

// Muted categorical series for charts; readable on both light and dark surfaces.
export const series = ["#4f7cac", "#c98b3a", "#5f9e7a", "#9a7bb5", "#c1675f", "#7d8a99"] as const;

export const layout = {
  siderWidth: 248,
  siderCollapsed: 64,
  contentMaxWidth: 1680,
} as const;

export const monoFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
