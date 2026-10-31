import * as React from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-md border border-border-strong bg-surface-2 px-3 text-sm text-foreground placeholder:text-subtle outline-none transition-colors focus:border-crust disabled:opacity-50";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, "min-h-20 resize-y py-2 leading-relaxed", className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-xs font-medium text-muted", className)} {...props} />;
}
