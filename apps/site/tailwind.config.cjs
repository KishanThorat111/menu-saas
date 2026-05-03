/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand: warm copper, slate, and a deep ink for premium SaaS feel
        brand: {
          50: '#fdf6ee',
          100: '#fbe9d2',
          200: '#f5cfa1',
          300: '#eeae6a',
          400: '#e08e3f',
          500: '#c97426',
          600: '#aa5a1d',
          700: '#88451a',
          800: '#6b371a',
          900: '#4a2611'
        },
        ink: {
          50:  '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#070b14'
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace']
      },
      fontSize: {
        '7xl': ['4.5rem', { lineHeight: '1.05', letterSpacing: '-0.035em' }],
        '6xl': ['3.75rem', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
        '5xl': ['3rem',    { lineHeight: '1.1',  letterSpacing: '-0.025em' }],
        '4xl': ['2.25rem', { lineHeight: '1.15', letterSpacing: '-0.02em' }]
      },
      animation: {
        'fade-up':   'fadeUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in':   'fadeIn 0.6s ease-out both',
        'glow':      'glow 8s ease-in-out infinite',
        'shimmer':   'shimmer 2.6s linear infinite'
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' }
        },
        glow: {
          '0%, 100%': { opacity: '0.55' },
          '50%':      { opacity: '0.95' }
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      },
      boxShadow: {
        'soft': '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 8px 24px -8px rgb(0 0 0 / 0.08)',
        'lift': '0 10px 30px -10px rgb(0 0 0 / 0.18)',
        'ring-brand': '0 0 0 1px rgb(201 116 38 / 0.35), 0 8px 30px -10px rgb(201 116 38 / 0.35)'
      },
      backgroundImage: {
        'grid-light': 'radial-gradient(circle at 1px 1px, rgb(15 23 42 / 0.08) 1px, transparent 0)',
        'grid-dark':  'radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.08) 1px, transparent 0)'
      }
    }
  },
  plugins: []
};
