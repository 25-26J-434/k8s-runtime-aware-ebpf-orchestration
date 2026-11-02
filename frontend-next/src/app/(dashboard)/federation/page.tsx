import type { Metadata } from "next";
import { FederationView } from "@/features/federation/components/FederationView";

export const metadata: Metadata = { title: "Federation" };

export default function FederationPage() {
  return <FederationView />;
}
