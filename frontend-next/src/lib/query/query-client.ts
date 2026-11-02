import { isServer, QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/errors";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (count, err) => count < 2 && (!(err instanceof ApiError) || err.retryable),
      },
      mutations: { retry: false },
    },
  });
}

let browserClient: QueryClient | undefined;

/** One client per browser session; a fresh one per request on the server (SSR-safe). */
export function getQueryClient() {
  if (isServer) return makeQueryClient();
  return (browserClient ??= makeQueryClient());
}
