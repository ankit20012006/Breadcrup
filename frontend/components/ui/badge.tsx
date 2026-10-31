import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 [&_svg]:size-3", {
  variants: {
    variant: {
      default: "bg-surface-3 text-muted",
      crust: "bg-crust-soft text-crust",
      signal: "bg-signal-soft text-signal",
      sage: "bg-sage-soft text-sage",
      ember: "bg-ember-soft text-ember",
      outline: "border border-border-strong text-muted",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
