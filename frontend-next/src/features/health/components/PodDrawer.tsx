"use client";

import { Button, Descriptions, Drawer, Typography } from "antd";
import { StatusText } from "@/components/common/StatusText";
import { podStatus } from "../utils/pod-status";
import type { PodRow } from "./PodTable";

interface PodDrawerProps {
  pod: PodRow | null;
  restarting: boolean;
  onClose: () => void;
  onRestart: (p: PodRow) => void;
}

export function PodDrawer({ pod, restarting, onClose, onRestart }: PodDrawerProps) {
  const status = pod ? podStatus(pod) : null;
  return (
    <Drawer
      open={!!pod}
      onClose={onClose}
      size={400}
      title={pod?.name}
      footer={pod && <Button danger loading={restarting} onClick={() => onRestart(pod)}>Restart pod</Button>}
    >
      {pod && status && (
        <>
          <Descriptions
            column={1}
            size="small"
            items={[
              { key: "ns", label: "Namespace", children: pod.namespace },
              { key: "node", label: "Node", children: pod.nodeKey },
              { key: "status", label: "Status", children: <StatusText tone={status.tone} label={status.label} /> },
              { key: "phase", label: "Phase", children: pod.phase },
              { key: "ready", label: "Ready", children: pod.ready ? "Yes" : "No" },
              { key: "restarts", label: "Restarts", children: pod.restart_count },
            ]}
          />
          {pod.health_reasons && pod.health_reasons.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Typography.Text strong>Flagged because</Typography.Text>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {pod.health_reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
