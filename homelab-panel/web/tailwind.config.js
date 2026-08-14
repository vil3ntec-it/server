/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // سطوح و متن — با متغیرهای CSS کار می‌کنند تا تم روشن/تیره یک‌جا عوض شود
        surface: {
          DEFAULT: 'var(--surface-1)',
          sunken: 'var(--surface-0)',
          raised: 'var(--surface-2)',
        },
        ink: {
          DEFAULT: 'var(--text-primary)',
          soft: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        line: 'var(--border)',
        brand: 'var(--series-1)',
        series: {
          1: 'var(--series-1)',
          2: 'var(--series-2)',
          3: 'var(--series-3)',
        },
        state: {
          good: 'var(--status-good)',
          warn: 'var(--status-warning)',
          bad: 'var(--status-critical)',
        },
      },
      fontFamily: {
        sans: ['Vazirmatn', 'Segoe UI', 'Tahoma', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
    },
  },
  plugins: [],
};
