import { JSX, splitProps } from "solid-js";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-blue-600 text-white hover:bg-blue-500 shadow-md shadow-blue-500/20",
        destructive: "bg-red-600 text-white hover:bg-red-500 shadow-md",
        outline: "border border-slate-700 bg-transparent hover:bg-slate-800 text-slate-200",
        secondary: "bg-slate-800 text-slate-100 hover:bg-slate-700",
        ghost: "hover:bg-slate-800 text-slate-300 hover:text-white",
        link: "text-blue-400 underline-offset-4 hover:underline",
        glass: "bg-slate-900/60 backdrop-blur-md border border-slate-800/60 text-slate-100 hover:bg-slate-800/80 shadow-lg",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6 text-base",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends JSX.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button(props: ButtonProps) {
  const [local, others] = splitProps(props, ["variant", "size", "class", "children"]);

  return (
    <button
      class={cn(buttonVariants({ variant: local.variant, size: local.size }), local.class)}
      {...others}
    >
      {local.children}
    </button>
  );
}
