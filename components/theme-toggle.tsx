'use client';

import { useTheme, ThemeMode } from './theme-provider';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const options: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme selection"
      className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-100 p-0.5 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400"
    >
      {options.map((option) => {
        const isActive = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => setTheme(option.value)}
            className={`rounded px-2 py-1 transition-colors cursor-pointer select-none ${
              isActive
                ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50 font-semibold'
                : 'hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
