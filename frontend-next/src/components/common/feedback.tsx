"use client";

import { Alert, Button, Empty, Skeleton } from "antd";
import { errorMessage } from "@/lib/api/errors";

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <>
          <div>{title}</div>
          {description && <div style={{ fontSize: 12, opacity: 0.7 }}>{description}</div>}
        </>
      }
      style={{ padding: "20px 0" }}
    />
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert
      type="error"
      showIcon
      title={errorMessage(error)}
      action={onRetry && <Button size="small" onClick={onRetry}>Retry</Button>}
    />
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return <Skeleton active title={false} paragraph={{ rows }} />;
}
