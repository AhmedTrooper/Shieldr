import { Component, createSignal, onCleanup, onMount } from "solid-js";
import { clsx } from "clsx";

interface LockIconWidgetProps {
  isLocked: boolean;
  position: "floating" | "center" | "top-right" | "bottom-right";
  autohideSecs: number;
  shaking: boolean;
  isUnlocking: boolean;
  onClick: () => void;
}

export const LockIconWidget: Component<LockIconWidgetProps> = (props) => {
  const [isIdle, setIsIdle] = createSignal(false);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    setIsIdle(false);
    if (idleTimer) clearTimeout(idleTimer);
    if (props.autohideSecs > 0 && props.isLocked) {
      idleTimer = setTimeout(() => {
        setIsIdle(true);
      }, props.autohideSecs * 1000);
    }
  };

  onMount(() => {
    window.addEventListener("mousemove", resetIdleTimer);
    window.addEventListener("touchstart", resetIdleTimer);
    window.addEventListener("keydown", resetIdleTimer);
    resetIdleTimer();
  });

  onCleanup(() => {
    window.removeEventListener("mousemove", resetIdleTimer);
    window.removeEventListener("touchstart", resetIdleTimer);
    window.removeEventListener("keydown", resetIdleTimer);
    if (idleTimer) clearTimeout(idleTimer);
  });

  const getPositionClasses = () => {
    switch (props.position) {
      case "center":
        return "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 hover:scale-110";
      case "top-right":
        return "top-4 right-4 hover:scale-108";
      case "bottom-right":
        return "bottom-4 right-4 hover:scale-108";
      case "floating":
      default:
        return "top-5 right-5 hover:scale-108";
    }
  };

  return (
    <div
      class={clsx(
        "fixed z-[1000] flex flex-col items-center gap-1.5 cursor-pointer select-none",
        "transition-[opacity,transform] duration-500 ease-out",
        getPositionClasses(),
        isIdle() ? "opacity-[0.08] hover:opacity-100" : "opacity-100",
        props.shaking && "animate-[shakeElastic_0.45s_cubic-bezier(0.36,0.07,0.19,0.97)_both]",
        props.isUnlocking && "drop-shadow-[0_0_20px_rgba(16,185,129,0.7)]"
      )}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
      title="Click to Unlock Shield"
    >
      <div
        class={clsx(
          "absolute w-[68px] h-[68px] rounded-full",
          "bg-[radial-gradient(circle,rgba(59,130,246,0.35)_0%,transparent_70%)]",
          "animate-[breathingGlow_3s_ease-in-out_infinite] pointer-events-none"
        )}
      />
      <svg
        class={clsx(
          "w-[50px] h-[50px] transition-transform duration-300",
          props.isUnlocking ? "text-emerald-400" : "text-blue-300 drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]"
        )}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Animated Shackle */}
        <path
          class={clsx(
            "transition-all duration-350 ease-out origin-[24px_22px]",
            props.isUnlocking
              ? "-translate-y-2.5 rotate-[15deg] text-emerald-400"
              : "translate-y-0 text-blue-300"
          )}
          d="M16 22V14C16 9.58172 19.5817 6 24 6C28.4183 6 32 9.58172 32 14V22"
          stroke="currentColor"
          stroke-width="4.5"
          stroke-linecap="round"
        />

        {/* Lock Body */}
        <rect
          x="10"
          y="20"
          width="28"
          height="22"
          rx="6"
          fill="url(#bodyGradient)"
          stroke="rgba(255, 255, 255, 0.25)"
          stroke-width="1.5"
        />

        {/* Keyhole */}
        <circle cx="24" cy="29" r="2.5" fill="rgba(0, 0, 0, 0.7)" />
        <path
          d="M22.8 29.5L22 36H26L25.2 29.5"
          fill="rgba(0, 0, 0, 0.7)"
        />

        {/* Shimmer Highlight */}
        <rect
          x="12"
          y="22"
          width="24"
          height="3"
          rx="1.5"
          fill="rgba(255, 255, 255, 0.3)"
        />

        <defs>
          <linearGradient id="bodyGradient" x1="10" y1="20" x2="38" y2="42" gradientUnits="userSpaceOnUse">
            <stop stop-color={props.isUnlocking ? "#34d399" : "#60a5fa"} />
            <stop offset="1" stop-color={props.isUnlocking ? "#059669" : "#2563eb"} />
          </linearGradient>
        </defs>
      </svg>
      <span
        class={clsx(
          "text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full",
          "bg-slate-900/90 backdrop-blur-md border border-white/20 text-slate-100 shadow-md pointer-events-none opacity-95"
        )}
      >
        Unlock
      </span>
    </div>
  );
};
