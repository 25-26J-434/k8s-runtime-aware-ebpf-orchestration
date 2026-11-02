import type { Metadata } from "next";
import { ExtensionsView } from "@/features/extensions/components/ExtensionsView";

export const metadata: Metadata = { title: "Extensions" };

export default async function ExtensionsPage({ params }: { params: Promise<{ name?: string[] }> }) {
  const { name } = await params;
  return <ExtensionsView name={name?.[0]} />;
}
