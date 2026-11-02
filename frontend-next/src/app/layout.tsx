import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Providers } from "./providers";
import { THEME_COOKIE } from "@/lib/theme/mode";

export const metadata: Metadata = {
  title: { default: "Kernel Eye", template: "%s · Kernel Eye" },
  description: "eBPF telemetry and orchestration for Kubernetes.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The preference is a cookie so the server renders the right theme on first paint.
  const saved = (await cookies()).get(THEME_COOKIE)?.value;
  const mode = saved === "dark" ? "dark" : "light";

  return (
    <html lang="en" style={{ colorScheme: mode }} suppressHydrationWarning>
      <body style={{ margin: 0, background: mode === "dark" ? "#111318" : "#f3f4f7" }}>
        <Providers initialMode={mode}>{children}</Providers>
      </body>
    </html>
  );
}
