import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { PageLoading } from "./components/page-loading";

export const getRouter = () => {
  // Data stays fresh for 20 s and isn't fetched again just because the window
  // got focus: on slow connections every repeat request costs seconds. Pages
  // that must stay live (render progress) poll on their own.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 2 },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // A page whose code takes more than a moment to arrive shows a loading
    // screen instead of nothing.
    defaultPendingComponent: PageLoading,
    defaultPendingMs: 600,
  });

  return router;
};
