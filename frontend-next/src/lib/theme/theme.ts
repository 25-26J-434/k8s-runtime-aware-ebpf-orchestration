import { theme as antd, type ThemeConfig } from "antd";
import { status, type Mode } from "./tokens";

/**
 * Neutral and calm: standard antd sizing at 14px, 6-8px radii, no shadows, one restrained blue.
 * Component overrides stay minimal so it reads as a tool, not a template.
 */
export function buildTheme(mode: Mode): ThemeConfig {
  const dark = mode === "dark";
  return {
    algorithm: dark ? antd.darkAlgorithm : antd.defaultAlgorithm,
    token: {
      colorPrimary: dark ? "#6c9be0" : "#2456a6",
      colorSuccess: status.success,
      colorWarning: status.warning,
      colorError: status.critical,
      colorInfo: status.info,
      colorBgBase: dark ? "#1a1d24" : "#ffffff",
      colorBgContainer: dark ? "#1a1d24" : "#ffffff",
      colorBgElevated: dark ? "#232731" : "#ffffff",
      colorBgLayout: dark ? "#111318" : "#f3f4f7",
      colorBorder: dark ? "#363b47" : "#d5d9e0",
      colorBorderSecondary: dark ? "#2b303b" : "#e4e7ec",
      colorText: dark ? "rgba(255,255,255,0.90)" : "rgba(15,23,42,0.92)",
      colorTextSecondary: dark ? "rgba(255,255,255,0.72)" : "rgba(15,23,42,0.68)",
      colorTextDescription: dark ? "rgba(255,255,255,0.60)" : "rgba(15,23,42,0.56)",
      colorTextTertiary: dark ? "rgba(255,255,255,0.50)" : "rgba(15,23,42,0.45)",
      borderRadius: 6,
      borderRadiusLG: 8,
      borderRadiusSM: 4,
      fontSize: 14,
      controlHeight: 34,
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      boxShadow: "none",
      boxShadowSecondary: "0 2px 8px rgba(0,0,0,0.18)",
      wireframe: false,
    },
    components: {
      Layout: { headerBg: dark ? "#1a1d24" : "#ffffff", siderBg: dark ? "#1a1d24" : "#ffffff", bodyBg: dark ? "#111318" : "#f3f4f7" },
      Menu: { itemHeight: 40, itemMarginInline: 8, itemBorderRadius: 6, activeBarBorderWidth: 0, iconSize: 16 },
      Table: { headerBg: dark ? "#20242c" : "#f7f8fa", cellPaddingBlock: 12, cellPaddingInline: 16, headerSplitColor: "transparent" },
      Descriptions: { labelBg: "transparent" },
    },
  };
}
