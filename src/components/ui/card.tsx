import { JSX, splitProps } from "solid-js";
import { cn } from "../../lib/utils";

export function Card(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <div
      class={cn(
        "rounded-xl border border-slate-800 bg-slate-900/80 backdrop-blur-md text-slate-100 shadow-xl",
        local.class
      )}
      {...others}
    >
      {local.children}
    </div>
  );
}

export function CardHeader(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <div class={cn("flex flex-col space-y-1.5 p-4 sm:p-5", local.class)} {...others}>
      {local.children}
    </div>
  );
}

export function CardTitle(props: JSX.HTMLAttributes<HTMLHeadingElement>) {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <h3
      class={cn("text-base font-bold leading-none tracking-tight text-white", local.class)}
      {...others}
    >
      {local.children}
    </h3>
  );
}

export function CardDescription(props: JSX.HTMLAttributes<HTMLParagraphElement>) {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <p class={cn("text-xs text-slate-400 leading-relaxed", local.class)} {...others}>
      {local.children}
    </p>
  );
}

export function CardContent(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <div class={cn("p-4 sm:p-5 pt-0", local.class)} {...others}>
      {local.children}
    </div>
  );
}

export function CardFooter(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <div class={cn("flex items-center p-4 sm:p-5 pt-0", local.class)} {...others}>
      {local.children}
    </div>
  );
}
