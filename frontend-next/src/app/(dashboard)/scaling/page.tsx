import type { Metadata } from "next";
import { ScalingView } from "@/features/scaling/components/ScalingView";

export const metadata: Metadata = { title: "Scaling" };

export default function ScalingPage() {
  return <ScalingView />;
}
