"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = React.createContext<(tone: Tone, message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((tone: Tone, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto" aria-live="polite">
        {toasts.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? CircleAlert : Info;
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-2 rounded-lg border bg-surface-2 px-3 py-2.5 text-sm shadow-xl",
                t.tone === "success" && "border-sage/40",
                t.tone === "error" && "border-ember/40",
                t.tone === "info" && "border-border-strong",
              )}
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", t.tone === "success" ? "text-sage" : t.tone === "error" ? "text-ember" : "text-muted")} />
              <span className="flex-1">{t.message}</span>
              <button aria-label="Dismiss" className="text-subtle hover:text-foreground" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => React.useContext(ToastContext);
