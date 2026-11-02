"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { App, ConfigProvider } from "antd";
import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query/query-client";
import { buildTheme } from "@/lib/theme/theme";
import { writeThemeCookie } from "@/lib/theme/mode";
import { setNotifier } from "@/lib/notify";
import type { Mode } from "@/lib/theme/tokens";
import { AntdRegistry } from "./antd-registry";

interface ColorModeValue {
  mode: Mode;
  toggle: () => void;
}

const ColorModeContext = createContext<ColorModeValue>({ mode: "light", toggle: () => {} });
export const useColorMode = () => useContext(ColorModeContext);

function NotifyBridge() {
  const { message } = App.useApp();
  useEffect(() => {
    setNotifier(message);
    return () => setNotifier(null);
  }, [message]);
  return null;
}

export function Providers({ children, initialMode }: { children: React.ReactNode; initialMode: Mode }) {
  const queryClient = getQueryClient();
  const [mode, setMode] = useState<Mode>(initialMode);

  const toggle = useCallback(() => {
    const next: Mode = mode === "dark" ? "light" : "dark";
    writeThemeCookie(next);
    document.documentElement.style.colorScheme = next;
    document.body.style.background = next === "dark" ? "#111318" : "#f3f4f7";
    setMode(next);
  }, [mode]);

  const theme = useMemo(() => buildTheme(mode), [mode]);
  const value = useMemo(() => ({ mode, toggle }), [mode, toggle]);

  return (
    <AntdRegistry>
      <ColorModeContext.Provider value={value}>
        <ConfigProvider theme={theme}>
          <App>
            <NotifyBridge />
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          </App>
        </ConfigProvider>
      </ColorModeContext.Provider>
    </AntdRegistry>
  );
}
