import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { friendlyError } from "@/lib/service-problems";

// Problems on the app's side (an AI service out of credit, a key, a setting)
// reach customers as a friendly line; the owner gets an alert with the real
// reason (src/lib/service-problems.ts).
const friendlyErrors = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (e) {
    // The real error goes to error monitoring (when on); the customer gets
    // the friendly version.
    const { reportServerError } = await import("@/lib/sentry.server");
    reportServerError(e, "server-function");
    throw friendlyError(e);
  }
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    const { reportServerError } = await import("@/lib/sentry.server");
    reportServerError(error, "request");
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, friendlyErrors],
  requestMiddleware: [errorMiddleware],
}));
