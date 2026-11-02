"use client";

import { Alert } from "antd";
import { PageHeader } from "@/components/common/PageHeader";

export function SchedulingPlaceholder() {
  return (
    <>
      <PageHeader title="Latency-Aware Scheduling" />
      <Alert
        type="info"
        showIcon
        title="Not implemented"
        description="The daemon has no scheduling API yet, so there is nothing to configure here. The signals it would use (DNS latency, RTT, run-queue delay) are already on the Dashboard."
      />
    </>
  );
}
