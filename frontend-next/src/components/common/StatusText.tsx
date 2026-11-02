"use client";

import { theme } from "antd";
import type { Tone } from "./tone";

/** Status as a coloured dot and plain text. Used instead of a coloured chip per row. */
export function StatusText({ tone, label }: { tone: Tone; label: string }) {
  const { token } = theme.useToken();
  const colour =
    tone === "success" ? token.colorSuccess : tone === "warning" ? token.colorWarning : tone === "critical" ? token.colorError : tone === "info" ? token.colorInfo : token.colorTextQuaternary;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: colour, flexShrink: 0 }} aria-hidden />
      {label}
    </span>
  );
}
