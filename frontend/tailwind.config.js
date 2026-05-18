/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ncp: {
          primary:   '#2563EB',   // blue-600
          secondary: '#1D4ED8',   // blue-700 (hover)
          light:     '#EFF6FF',   // blue-50  (bg tint)
          border:    '#BFDBFE',   // blue-200
          sidebar:   '#0F172A',   // slate-900
          'sidebar-hover': '#1E293B', // slate-800
          dark:      '#1A1A1A',
          gray:      '#64748B'    // slate-500
        }
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.06)',
        'card-hover': '0 4px 12px 0 rgba(37,99,235,0.10), 0 1px 3px 0 rgba(0,0,0,0.06)',
      }
    },
  },
  plugins: [],
}
