"use client";

import { Button, Descriptions, Drawer, Popconfirm, Space } from "antd";
import { StatusText } from "@/components/common/StatusText";
import { useClusterSummary, usePolicyMutations } from "../hooks/use-routing";
import { buildCreateBody, buildUpdateBody, DEFAULT_FORM, policyState, resolveFrontend, resolveMetric, resolveProtocol, resolveTarget, resolveThreshold, resolveTtl, toFormValues, type PolicyFormValues } from "../lib/policy";
import { FORM_ID, PolicyForm } from "./PolicyForm";
import type { PolicyRecord } from "@/types/routing";

export type DrawerMode = "view" | "edit" | "create";

interface Props {
  open: boolean;
  mode: DrawerMode;
  policy: PolicyRecord | null;
  onMode: (m: DrawerMode) => void;
  onClose: () => void;
}

const STATE_TONE = { active: "success", expired: "neutral", unknown: "neutral" } as const;

export function PolicyDrawer({ open, mode, policy, onMode, onClose }: Props) {
  const { create, update, remove } = usePolicyMutations();
  // Namespace/service/selector suggestions come from the cluster summary; only needed while editing.
  const summary = useClusterSummary(open && mode !== "view");
  const saving = create.isPending || update.isPending;

  const submit = (v: PolicyFormValues) => {
    if (mode === "create") create.mutate(buildCreateBody(v), { onSuccess: onClose });
    else if (policy?.policy_name) update.mutate({ name: policy.policy_name, body: buildUpdateBody(v, policy) }, { onSuccess: onClose });
  };

  const title = mode === "create" ? "New routing policy" : (policy?.policy_name ?? "Policy");
  const front = policy ? resolveFrontend(policy) : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={560}
      destroyOnHidden
      title={title}
      footer={
        mode === "view" ? undefined : (
          <Space style={{ justifyContent: "flex-end", width: "100%" }}>
            <Button onClick={() => (mode === "edit" ? onMode("view") : onClose())}>Cancel</Button>
            <Button type="primary" htmlType="submit" form={FORM_ID} loading={saving}>{mode === "create" ? "Create policy" : "Save changes"}</Button>
          </Space>
        )
      }
      extra={
        policy && mode === "view" ? (
          <Space>
            <Button onClick={() => onMode("edit")}>Edit</Button>
            <Popconfirm title={`Delete ${policy.policy_name}?`} description="Its active redirect, if any, is removed." okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => policy.policy_name && remove.mutate(policy.policy_name, { onSuccess: onClose })}>
              <Button danger loading={remove.isPending}>Delete</Button>
            </Popconfirm>
          </Space>
        ) : null
      }
    >
      {mode === "view" && policy && front ? (
        <Descriptions
          column={1}
          size="small"
          bordered
          items={[
            { key: "ns", label: "Namespace", children: policy.namespace ?? "—" },
            { key: "scope", label: "Scope", children: policy.scope || "local" },
            { key: "state", label: "State", children: <StatusText tone={STATE_TONE[policyState(policy)]} label={policyState(policy)} /> },
            { key: "front", label: "Frontend", children: front.service ? `${front.service}:${front.port}` : "—" },
            { key: "metric", label: "Metric", children: resolveMetric(policy) },
            { key: "thr", label: "Violation threshold", children: String(resolveThreshold(policy)) },
            { key: "tgt", label: "Redirect backend", children: resolveTarget(policy) },
            { key: "proto", label: "Protocol", children: resolveProtocol(policy) },
            { key: "ttl", label: "Lifetime (s)", children: String(resolveTtl(policy)) },
            { key: "created", label: "Created", children: policy.createdAt ? new Date(policy.createdAt).toLocaleString() : "—" },
            { key: "updated", label: "Updated", children: policy.updatedAt ? new Date(policy.updatedAt).toLocaleString() : "—" },
          ]}
        />
      ) : (
        <PolicyForm
          key={`${mode}-${policy?.policy_name ?? "new"}`}
          mode={mode === "create" ? "create" : "edit"}
          initial={mode === "create" ? DEFAULT_FORM : policy ? toFormValues(policy) : DEFAULT_FORM}
          summary={summary.data ?? null}
          summaryLoading={summary.isLoading}
          onSubmit={submit}
        />
      )}
    </Drawer>
  );
}
