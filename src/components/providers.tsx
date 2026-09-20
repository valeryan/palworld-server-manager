"use client";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

function LiveUpdates() {
  const client = useQueryClient();
  useEffect(() => {
    const stream = new EventSource("/api/events");
    const refresh = () => { void client.invalidateQueries({ queryKey: ["worlds"] }); void client.invalidateQueries({ queryKey: ["jobs"] }); };
    stream.addEventListener("world", refresh); stream.addEventListener("job", refresh);
    return () => stream.close();
  }, [client]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 2_000, refetchInterval: 10_000, retry: 1 } } }));
  return <QueryClientProvider client={client}><LiveUpdates />{children}</QueryClientProvider>;
}
