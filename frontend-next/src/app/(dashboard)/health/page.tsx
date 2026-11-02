import type { Metadata } from "next";
import { HealthView } from "@/features/health/components/HealthView";

export const metadata: Metadata = { title: "Cluster Health" };

export default function HealthPage() {
  return <HealthView />;
}
