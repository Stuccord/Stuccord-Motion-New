// The layout of the public legal pages (Terms, Privacy): a plain, readable
// column with a way back home.

import type React from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const SUPPORT_EMAIL = "support@stuccord.com";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** When it last changed, e.g. "31 October 2026". */
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-5 py-14">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Stuccord
        </Link>
        <h1 className="mt-8 font-display text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {updated}</p>
        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-foreground/90 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5 [&_a]:text-primary [&_a]:underline">
          {children}
        </div>
      </div>
    </div>
  );
}
