import type { Metadata } from "next";
import { TopologyView } from "@/features/topology/components/TopologyView";

export const metadata: Metadata = { title: "Network Topology" };

export default function TopologyPage() {
  return <TopologyView />;
}
