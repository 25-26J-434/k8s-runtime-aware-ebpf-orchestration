import type { Metadata } from "next";
import { RoutingView } from "@/features/routing/components/RoutingView";

export const metadata: Metadata = { title: "Routing" };

export default function RoutingPage() {
  return <RoutingView />;
}
