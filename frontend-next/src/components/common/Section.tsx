"use client";

import { Flex, Typography, theme } from "antd";

interface SectionProps {
  id?: string;
  title: string;
  extra?: React.ReactNode;
  /** Remove the panel padding (tables that run edge to edge). */
  flush?: boolean;
  children: React.ReactNode;
}

/** A titled block: heading above, content on a quiet bordered surface. Anchors match the dashboard menu. */
export function Section({ id, title, extra, flush, children }: SectionProps) {
  const { token } = theme.useToken();
  return (
    <section id={id} style={{ scrollMarginTop: 16, marginBottom: 32 }}>
      <Flex align="center" justify="space-between" style={{ marginBottom: 12 }}>
        <Typography.Title level={5} style={{ margin: 0, fontSize: 16 }}>
          {title}
        </Typography.Title>
        {extra}
      </Flex>
      <div
        style={{
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          padding: flush ? 0 : 20,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </section>
  );
}
