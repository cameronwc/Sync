/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Claude design language: warm ivory ground, warm-black ink, terracotta
      // accent. Token names are stable so existing classes retheme in place.
      colors: {
        ground: '#F0EEE6',
        ink: '#1F1E1D',
        rule: '#DEDAD1',
        signal: '#D97757',
        'signal-light': '#F0C8B4',
        alert: '#AB2B14',
      },
      fontFamily: {
        display: ['"Source Serif 4"', 'Georgia', 'serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
