import { JSX, splitProps } from "solid-js";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-blue-600 text-white",
        secondary: "border-transparent bg-slate-800 text-slate-200",
        destructive: "border-transparent bg-red-600 text-white",
        outline: "text-slate-300 border-slate-700",
        success: "border-transparent bg-emerald-600 text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends JSX.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge(props: BadgeProps) {
  const [local, others] = splitProps(props, ["variant", "class", "children"]);

  return (
    <div class={cn(badgeVariants({ variant: local.variant }), local.class)} {...others}>
      {local.children}
    </div>
  );
}
