/* @refresh reload */
import { render } from "solid-js/web";
import { ErrorBoundary } from "solid-js";
import { clsx } from "clsx";
import "./App.css";
import App from "./App";

const root = document.getElementById("root");

if (root) {
  render(
    () => (
      <ErrorBoundary
        fallback={(err, reset) => (
          <div
            class={clsx(
              "w-full h-full flex flex-col items-center justify-center p-6 text-center",
              "bg-slate-950 text-slate-100 select-none"
            )}
          >
            <div class={clsx("p-4 rounded-xl bg-red-500/10 border border-red-500/25 max-w-md w-full mb-4")}>
              <h2 class={clsx("text-base font-bold text-red-400 mb-1.5")}>Shieldr Encountered an Error</h2>
              <p class={clsx("text-xs text-slate-300 font-mono break-all mb-4")}>
                {err instanceof Error ? err.message : String(err)}
              </p>
              <button
                type="button"
                class={clsx(
                  "px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold",
                  "transition-colors cursor-pointer shadow-md shadow-blue-600/30"
                )}
                onClick={reset}
              >
                Reload Application
              </button>
            </div>
          </div>
        )}
      >
        <App />
      </ErrorBoundary>
    ),
    root
  );
}
