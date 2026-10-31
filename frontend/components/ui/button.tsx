import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-crust text-[#1a1206] hover:bg-honey font-semibold",
        signal: "bg-signal text-[#120c24] hover:brightness-110 font-semibold",
        secondary: "bg-surface-3 text-foreground hover:bg-border-strong",
        outline: "border border-border-strong bg-transparent text-foreground hover:bg-surface-2",
        ghost: "text-muted hover:text-foreground hover:bg-surface-2",
        danger: "bg-ember-soft text-ember border border-ember/30 hover:bg-ember/20",
        success: "bg-sage-soft text-sage border border-sage/30 hover:bg-sage/20",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6 text-base",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
