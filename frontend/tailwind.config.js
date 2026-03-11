/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        hacker: {
          900: '#0a0a0a',
          800: '#111111',
          700: '#1a1a1a',
          600: '#222222',
          500: '#333333',
          400: '#444444',
          300: '#666666',
          200: '#888888',
          100: '#aaaaaa',
          50: '#cccccc',
        },
        neon: {
          green: '#00ff00',
          blue: '#00ffff',
          pink: '#ff00ff',
          yellow: '#ffff00',
          red: '#ff0033',
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'Monaco', 'monospace'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
