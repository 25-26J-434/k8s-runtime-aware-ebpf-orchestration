"use client";

import { Skeleton, Typography, theme } from "antd";
import type { Tone } from "./tone";

export interface Stat {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}

/** Several numbers in one row with hairline dividers. Sits on its section panel or stands alone. */
export function StatStrip({ stats, loading, bare }: { stats: Stat[]; loading?: boolean; /** Draw without its own border (inside a Section). */ bare?: boolean }) {
  const { token } = theme.useToken();
  const colour = (t?: Tone) =>
    t === "critical" ? token.colorError : t === "warning" ? token.colorWarning : t === "success" ? token.colorSuccess : token.colorText;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        rowGap: 16,
        ...(bare ? {} : { border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, background: token.colorBgContainer, padding: "16px 0" }),
      }}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          style={{ flex: "1 1 150px", padding: "0 24px", borderLeft: i === 0 ? undefined : `1px solid ${token.colorBorderSecondary}`, minWidth: 0, ...(i === 0 && bare ? { paddingLeft: 0 } : {}) }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>{s.label}</Typography.Text>
          {loading ? (
            <Skeleton.Input active size="small" style={{ display: "block", width: 80, marginTop: 6 }} />
          ) : (
            <div style={{ fontSize: 26, lineHeight: "36px", fontWeight: 500, fontVariantNumeric: "tabular-nums", color: colour(s.tone) }}>{s.value}</div>
          )}
          {s.hint && <Typography.Text type="secondary" style={{ fontSize: 13 }} ellipsis>{s.hint}</Typography.Text>}
        </div>
      ))}
    </div>
  );
}
