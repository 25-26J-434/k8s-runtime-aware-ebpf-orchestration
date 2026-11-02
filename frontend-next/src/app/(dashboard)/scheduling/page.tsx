import type { Metadata } from "next";
import { SchedulingPlaceholder } from "@/features/scheduling/placeholder";

export const metadata: Metadata = { title: "Scheduling" };

export default function SchedulingPage() {
  return <SchedulingPlaceholder />;
}
