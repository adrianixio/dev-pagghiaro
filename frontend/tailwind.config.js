/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        rustic: {
          900: '#1a1412',
          800: '#2d241e',
          700: '#4a3b32',
          600: '#6b574b',
          500: '#8c7364',
          400: '#ad907e',
          300: '#cead98',
          200: '#e6ccb8',
          100: '#f4e4d8',
          50: '#faf5f0',
        },
        country: {
          green: '#556b2f',
          blue: '#4682b4',
          pink: '#d87093',
          yellow: '#daa520',
          red: '#8b0000',
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'Monaco', 'monospace'],
        sans: ['"Source Sans 3"', '"Trebuchet MS"', 'sans-serif'],
        display: ['"Bitter"', 'Georgia', 'serif'],
      }
    },
  },
  plugins: [],
}
