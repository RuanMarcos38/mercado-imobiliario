import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export type AppTheme = "light" | "dark";

const STORAGE_KEY = "mercadoimobi-theme";

function applyTheme(theme: AppTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("dark-mode", theme === "dark");
  root.classList.toggle("light-mode", theme === "light");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function initialTheme(): AppTheme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<AppTheme>("dark");

  useEffect(() => {
    const next = initialTheme();
    setTheme(next);
    applyTheme(next);
  }, []);

  const choose = (next: AppTheme) => {
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  if (compact) {
    const next = theme === "dark" ? "light" : "dark";
    return (
      <button
        type="button"
        onClick={() => choose(next)}
        className="theme-toggle-button grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-slate-300 transition hover:bg-white/5"
        aria-label={next === "light" ? "Usar tela clara" : "Usar tela escura"}
        title={next === "light" ? "Tela clara" : "Tela escura"}
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    );
  }

  return (
    <div className="theme-toggle-panel rounded-xl border border-white/10 bg-white/[0.035] p-1">
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => choose("light")}
          aria-pressed={theme === "light"}
          className={`flex h-9 items-center justify-center gap-2 rounded-lg px-2 text-xs font-bold transition ${
            theme === "light"
              ? "bg-cyan-300 text-[#06101c]"
              : "text-slate-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <Sun className="h-3.5 w-3.5" /> Claro
        </button>
        <button
          type="button"
          onClick={() => choose("dark")}
          aria-pressed={theme === "dark"}
          className={`flex h-9 items-center justify-center gap-2 rounded-lg px-2 text-xs font-bold transition ${
            theme === "dark"
              ? "bg-cyan-300 text-[#06101c]"
              : "text-slate-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <Moon className="h-3.5 w-3.5" /> Escuro
        </button>
      </div>
    </div>
  );
}
