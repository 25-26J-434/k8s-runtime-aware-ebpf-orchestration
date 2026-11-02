export const THEME_COOKIE = "console-theme";

/** Persist the theme for a year. Read by the root layout on the server. */
export function writeThemeCookie(mode: "light" | "dark") {
  document.cookie = `${THEME_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
}
