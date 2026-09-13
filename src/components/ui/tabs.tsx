import { Tabs as KobalteTabs } from "@kobalte/core/tabs";
import { splitProps } from "solid-js";
import { cn } from "../../lib/utils";

export const Tabs = KobalteTabs;

export function TabsList(props: Parameters<typeof KobalteTabs.List>[0] & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KobalteTabs.List
      class={cn(
        "inline-flex h-10 items-center justify-center rounded-lg bg-slate-900/60 p-1 text-slate-400 border border-slate-800/80 backdrop-blur-sm",
        local.class
      )}
      {...others}
    />
  );
}

export function TabsTrigger(props: Parameters<typeof KobalteTabs.Trigger>[0] & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KobalteTabs.Trigger
      class={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50 data-[selected]:bg-blue-600 data-[selected]:text-white data-[selected]:shadow-sm cursor-pointer",
        local.class
      )}
      {...others}
    />
  );
}

export function TabsContent(props: Parameters<typeof KobalteTabs.Content>[0] & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KobalteTabs.Content
      class={cn(
        "mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        local.class
      )}
      {...others}
    />
  );
}
