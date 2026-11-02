"use client";

import { Flex, Typography } from "antd";

interface PageHeaderProps {
  title: string;
  /** One short line, only when it says something the title does not. */
  note?: string;
  extra?: React.ReactNode;
}

export function PageHeader({ title, note, extra }: PageHeaderProps) {
  return (
    <Flex align="center" justify="space-between" wrap gap={12} style={{ marginBottom: 24 }}>
      <div style={{ minWidth: 0 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
          {title}
        </Typography.Title>
        {note && (
          <Typography.Text type="secondary" style={{ fontSize: 14 }}>
            {note}
          </Typography.Text>
        )}
      </div>
      {extra && <Flex align="center" gap={8} wrap>{extra}</Flex>}
    </Flex>
  );
}
