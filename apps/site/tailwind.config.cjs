/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf6ee', 100: '#fbe9d2', 200: '#f5cfa1', 300: '#eeae6a',
          400: '#e08e3f', 500: '#c97426', 600: '#aa5a1d', 700: '#88451a',
          800: '#6b371a', 900: '#4a2611'
        },
        ink: {
          50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
          400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155',
          800: '#1e293b', 900: '#0f172a', 950: '#070b14'
        }
      },
      fontFamily: {
        sans:    ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Instrument Serif"', '"Playfair Display"', 'ui-serif', 'Georgia', 'serif'],
        mono:    ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace']
      },
      fontSize: {
        '8xl': ['6.5rem', { lineHeight: '0.95', letterSpacing: '-0.04em' }],
        '7xl': ['5rem',   { lineHeight: '0.98', letterSpacing: '-0.035em' }],
        '6xl': ['3.75rem', { lineHeight: '1.02', letterSpacing: '-0.03em' }],
        '5xl': ['3rem',    { lineHeight: '1.08', letterSpacing: '-0.025em' }],
        '4xl': ['2.25rem', { lineHeight: '1.15', letterSpacing: '-0.02em' }]
      },
      animation: {
        'fade-up':     'fadeUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in':     'fadeIn 0.6s ease-out both',
        'glow':        'glow 8s ease-in-out infinite',
        'shimmer':     'shimmer 2.6s linear infinite',
        'float-slow':  'float 14s ease-in-out infinite',
        'float-slower':'float 22s ease-in-out infinite',
        'marquee':     'marquee 38s linear infinite',
        'marquee-rev': 'marquee 38s linear infinite reverse',
        'gradient-x':  'gradientX 8s ease infinite',
        'spin-slow':   'spin 14s linear infinite',
        'pulse-soft':  'pulseSoft 3.6s ease-in-out infinite'
      },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(14px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        glow:   { '0%, 100%': { opacity: '0.55' }, '50%': { opacity: '0.95' } },
        shimmer:{ '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        float:  {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%':      { transform: 'translate3d(0,-22px,0) scale(1.03)' }
        },
        marquee: {
          '0%':   { transform: 'translate3d(0,0,0)' },
          '100%': { transform: 'translate3d(-50%,0,0)' }
        },
        gradientX: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%':      { backgroundPosition: '100% 50%' }
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.6' },
          '50%':      { opacity: '1' }
        }
      },
      boxShadow: {
        'soft':       '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 8px 24px -8px rgb(0 0 0 / 0.08)',
        'lift':       '0 18px 50px -18px rgb(0 0 0 / 0.22)',
        'lift-lg':    '0 30px 80px -20px rgb(0 0 0 / 0.28)',
        'ring-brand': '0 0 0 1px rgb(201 116 38 / 0.35), 0 12px 40px -12px rgb(201 116 38 / 0.45)',
        'glow-brand': '0 0 60px -10px rgb(224 142 63 / 0.55)'
      },
      backgroundImage: {
        'grid-light': 'radial-gradient(circle at 1px 1px, rgb(15 23 42 / 0.08) 1px, transparent 0)',
        'grid-dark':  'radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.08) 1px, transparent 0)',
        'mesh-light': 'radial-gradient(at 12% 8%, rgb(238 174 106 / 0.45) 0px, transparent 45%), radial-gradient(at 88% 12%, rgb(255 200 140 / 0.35) 0px, transparent 45%), radial-gradient(at 60% 90%, rgb(201 116 38 / 0.30) 0px, transparent 50%), radial-gradient(at 18% 92%, rgb(170 90 29 / 0.18) 0px, transparent 45%)',
        'mesh-dark':  'radial-gradient(at 12% 8%, rgb(224 142 63 / 0.30) 0px, transparent 45%), radial-gradient(at 88% 12%, rgb(255 180 100 / 0.20) 0px, transparent 45%), radial-gradient(at 60% 90%, rgb(170 90 29 / 0.30) 0px, transparent 50%), radial-gradient(at 18% 92%, rgb(120 60 20 / 0.30) 0px, transparent 45%)'
      }
    }
  },
  plugins: []
};
