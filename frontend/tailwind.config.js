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
          950: '#120d0c', 900: '#1a1412', 800: '#261d19', 700: '#3f312b',
          600: '#5d4a41', 500: '#8c7364', 400: '#ad907e', 300: '#cead98',
          200: '#e6ccb8', 100: '#f4e4d8', 50: '#faf5f0',
        },
        country: {
          green: '#719337', blue: '#4c8cc0', pink: '#e6789c',
          yellow: '#ebb223', red: '#b40303',
        },
        // Semantic aliases (light value; dark handled via `dark:` utilities in components)
        surface: '#faf5f0',
        'surface-raised': '#ffffff',
        border: '#e6ccb8',
        content: '#1a1412',
        'content-muted': '#8c7364',
        accent: '#719337',
        danger: '#b40303',
        warning: '#ebb223',
        info: '#4c8cc0',
      },
      fontFamily: {
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'Consolas', 'Monaco', 'monospace'],
        sans: ['"Source Sans 3 Variable"', '"Source Sans 3"', '"Trebuchet MS"', 'sans-serif'],
        display: ['"Bitter"', 'Georgia', 'serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(63,49,43,.06), 0 1px 3px rgba(63,49,43,.05)',
        float: '0 8px 24px rgba(18,13,12,.28)',
      },
    },
  },
  plugins: [],
}
