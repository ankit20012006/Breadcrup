"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { ConnectScreen } from "@/components/dashboard/connect-screen";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { useDashboard } from "@/components/dashboard/useDashboard";
import { ToastProvider } from "@/components/toast";

export default function DashboardPage() {
  const dash = useDashboard();

  return (
    <ToastProvider>
      {dash.booting ? (
        <div className="grid min-h-dvh place-items-center text-muted">
          <Loader2 className="size-5 animate-spin" aria-label="Loading" />
        </div>
      ) : dash.token ? (
        <DashboardShell dash={dash} />
      ) : (
        <ConnectScreen dash={dash} />
      )}
    </ToastProvider>
  );
}
