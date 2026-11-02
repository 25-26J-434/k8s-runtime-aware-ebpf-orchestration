"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "antd";
import { PageHeader } from "@/components/common/PageHeader";
import { ErrorState, SkeletonRows } from "@/components/common/feedback";
import { useExtensionList } from "../hooks/use-extensions";
import { GenericExtension } from "./GenericExtension";
import { NotificationExtension } from "./NotificationExtension";

/** `/extensions` redirects to the first extension, like the legacy console; `/extensions/<name>` shows it. */
export function ExtensionsView({ name }: { name?: string }) {
  const router = useRouter();
  const list = useExtensionList();
  const exts = useMemo(() => list.data ?? [], [list.data]);
  const current = exts.find((e) => e.name === name);
  const target = name ?? exts[0]?.name;

  useEffect(() => {
    if (!name && exts[0]) router.replace(`/extensions/${exts[0].name}`);
  }, [name, exts, router]);

  if (list.isError && !list.data && name !== "notification") return (<><PageHeader title="Extensions" /><ErrorState error={list.error} onRetry={() => list.refetch()} /></>);
  if (list.isLoading) return (<><PageHeader title="Extensions" /><SkeletonRows rows={5} /></>);

  // The notification extension has its own config endpoint, so it works even if the listing omits it.
  if (target === "notification") {
    return (
      <>
        <PageHeader title={current?.label || "Notification"} note={current?.description || "Where alerts are sent and which conditions raise them"} />
        <NotificationExtension />
      </>
    );
  }

  if (!target) return (<><PageHeader title="Extensions" /><Alert type="info" showIcon title="No extensions are installed on the daemon." /></>);
  if (!current) return (<><PageHeader title="Extensions" /><Alert type="warning" showIcon title={`Extension "${name}" was not found.`} /></>);

  return (
    <>
      <PageHeader title={current.label || current.name} note={current.description} />
      <GenericExtension ext={current} />
    </>
  );
}
