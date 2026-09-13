import { Component, createSignal, onCleanup, onMount } from "solid-js";

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

  const getPositionClass = () => {
    switch (props.position) {
      case "center":
        return "pos-center";
      case "top-right":
        return "pos-top-right";
      case "bottom-right":
        return "pos-bottom-right";
      case "floating":
      default:
        return "pos-floating";
    }
  };

  return (
    <div
      class={`lock-widget-container ${getPositionClass()} ${isIdle() ? "idle-fade" : ""} ${
        props.shaking ? "shaking" : ""
      } ${props.isUnlocking ? "unlocking-glow" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
      title="Click to Unlock Shield"
    >
      <div class="lock-glow-ring" />
      <svg
        class={`padlock-svg ${props.isUnlocking ? "shackle-open" : "shackle-closed"}`}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Animated Shackle */}
        <path
          class="shackle"
          d="M16 22V14C16 9.58172 19.5817 6 24 6C28.4183 6 32 9.58172 32 14V22"
          stroke="currentColor"
          stroke-width="4.5"
          stroke-linecap="round"
        />

        {/* Lock Body */}
        <rect
          class="body"
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
            <stop stop-color="#60a5fa" />
            <stop offset="1" stop-color="#2563eb" />
          </linearGradient>
        </defs>
      </svg>
      <span class="lock-hint-pill">Unlock</span>
    </div>
  );
};
