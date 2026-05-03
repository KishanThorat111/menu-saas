// Central place for everything that varies across pages.
// Editing copy here cascades through the site.

export const SITE = {
  name: 'KodSpot',
  legalName: 'KODSPOT',
  tagline: 'Operations Technology for Physical Businesses',
  description:
    'KodSpot builds specialised, multi-tenant SaaS platforms that digitise housekeeping, electrical maintenance, and customer engagement for hospitals, hotels, and restaurants across India.',
  url: 'https://kodspot.com',
  email: 'kishan@kodspot.com',
  founderEmail: 'kishan@kodspot.com',
  whatsapp: '+91 76766 99291',
  whatsappUrl: 'https://wa.me/917676699291',
  phone: '+91 76766 99291',
  city: 'Belagavi, Karnataka, India',
  address: {
    line1: '487, Muralidhar Colony',
    line2: 'Hanuman Nagar, Scheme No 40',
    city: 'Belagavi',
    state: 'Karnataka',
    pin: '590019',
    country: 'India'
  },
  founder: {
    name: 'Kishan Thorat',
    legalName: 'Kishan Ashok Thorat',
    title: 'Founder & Engineer',
    location: 'Belagavi, Karnataka',
    photo: '/KishanThorat.jpg',
    initials: 'KT',
    bio: 'Single-founder, full-stack engineer building specialised SaaS for India’s physical operations economy.'
  },
  legal: {
    udyamNumber: 'UDYAM-KR-04-0179635',
    udyam: 'Udyam Registered · UDYAM-KR-04-0179635',
    structure: 'Sole Proprietorship',
    classification: 'Micro Enterprise · Services',
    incorporated: '01 Feb 2026'
  },
  social: {
    linkedin: '',
    github: ''
  }
} as const;

export const NAV_LINKS = [
  { href: '/products',     label: 'Products' },
  { href: '/technology',   label: 'Technology' },
  { href: '/services',     label: 'Services' },
  { href: '/case-studies', label: 'Case Studies' },
  { href: '/about',        label: 'About' }
] as const;

export const FOOTER_GROUPS = [
  {
    title: 'Products',
    links: [
      { href: '/products/menu',         label: 'KodSpot Menu' },
      { href: '/products/housekeeping', label: 'KodSpot Housekeeping' },
      { href: '/products/electrical',   label: 'KodSpot Electrical' }
    ]
  },
  {
    title: 'Company',
    links: [
      { href: '/about',        label: 'About' },
      { href: '/case-studies', label: 'Case Studies' },
      { href: '/services',     label: 'Services' },
      { href: '/contact',      label: 'Contact' }
    ]
  },
  {
    title: 'Platform',
    links: [
      { href: '/technology', label: 'Technology' },
      { href: '/admin',      label: 'Customer Login', external: true },
      { href: '/superadmin', label: 'Operator Console', external: true }
    ]
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy Policy', external: true },
      { href: '/terms',   label: 'Terms of Service', external: true },
      { href: '/refund',  label: 'Refund Policy',    external: true }
    ]
  }
] as const;

// Conservative, factually defensible numbers.
export const STATS = [
  { value: '3',     label: 'Production SaaS platforms' },
  { value: 'KLE',   label: 'Anchor institutional clients (Hospital, Hotel Mgmt, JNMC)' },
  { value: '99.9%', label: 'Target uptime SLO' },
  { value: '24×7', label: 'Operations workflows running on KodSpot' }
] as const;

export const PRODUCTS = [
  {
    slug: 'menu',
    name: 'KodSpot Menu',
    short: 'QR-based digital menu SaaS for restaurants, cafés and hotels.',
    long:
      'Short, brand-safe QR menus with theme-based design, UPI Pay, plan-gated features, analytics, printable QR cards and Razorpay billing — all running on a multi-tenant Fastify + PostgreSQL backend.',
    audience: 'Restaurants · Cafés · Hotels',
    color: 'from-brand-500 to-brand-700',
    icon: 'menu',
    domain: 'kodspot.com',
    status: 'Live'
  },
  {
    slug: 'housekeeping',
    name: 'KodSpot Housekeeping',
    short: 'Multi-tenant housekeeping & facility operations for hotels and hospitals.',
    long:
      'Attendance with photo / QR / geolocation validation, multi-floor supervisor workflows, cleaning evidence capture, maintenance ticketing, leave management and AI-powered analytics with SQL-first cost control.',
    audience: 'Hospitals · Hotels · Facilities',
    color: 'from-emerald-500 to-emerald-700',
    icon: 'sparkle',
    domain: 'kodspot.in',
    status: 'Production'
  },
  {
    slug: 'electrical',
    name: 'KodSpot Electrical',
    short: 'Inspection, asset reliability and complaint platform for electrical operations.',
    long:
      'Inspection templates, asset lifecycle and failure tracking, alert / escalation engine, public QR complaint flow with guest review, predictive risk scoring and offline-capable PWA for field execution.',
    audience: 'Hospitals · Hotels · Manufacturing',
    color: 'from-sky-500 to-indigo-600',
    icon: 'bolt',
    domain: 'kodspot.in',
    status: 'Production'
  }
] as const;

export const SERVICES = [
  {
    name: 'Custom Web Development',
    desc: 'Production-grade websites and internal tools, built on the same engineering discipline as our SaaS platforms.',
    icon: 'globe'
  },
  {
    name: 'E-commerce Platforms',
    desc: 'Headless and multi-vendor stores, inventory + order workflows, payment integration and analytics.',
    icon: 'cart'
  },
  {
    name: 'AI Automation',
    desc: 'AI agents for social media, content workflows and back-office automation — built with cost-controlled LLM routing.',
    icon: 'spark'
  },
  {
    name: 'Cloud Architecture & Cost Engineering',
    desc: 'Multi-cloud deployment design (GCP / AWS / Azure), container hardening, and SQL-first cost optimisation.',
    icon: 'cloud'
  }
] as const;

export const TECH_STACK = [
  { group: 'Application', items: ['Node.js 20', 'Fastify 4', 'Prisma 5', 'TypeScript / Modern JS'] },
  { group: 'Data',        items: ['PostgreSQL 15', 'Soft-delete + scheduled purge', 'Encrypted PII (AES-256-GCM)', 'Audit-log everywhere'] },
  { group: 'AI / ML',     items: ['Vertex AI', 'Gemini', 'Azure OpenAI', 'SQL-first cost router · per-org token caps'] },
  { group: 'Infra',       items: ['Docker Compose', 'Caddy 2 (auto-TLS)', 'Cloudflare R2 object storage', 'GCP Compute Engine — multi-cloud ready'] },
  { group: 'Delivery',    items: ['PWA · offline queues', 'GitHub Actions CI/CD', 'Health-checked containers', 'Encrypted DB backups'] },
  { group: 'Security',    items: ['JWT + bcrypt + pepper', 'Rate-limited per-IP / per-tenant', 'Strict CSP, HSTS, frame-deny', 'DPDPA-aligned retention'] }
] as const;

// Real institutional clients in Belagavi (KLE Society — one of South India's
// largest education + healthcare groups). Names are used with permission;
// engagement specifics are intentionally framed at a level our clients are
// comfortable being public about.
export const CASE_STUDIES = [
  {
    slug: 'kle-hospital',
    title: 'Multi-floor housekeeping at a tertiary-care teaching hospital',
    client: 'KLE Dr. Prabhakar Kore Hospital & MRC',
    industry: 'Healthcare',
    product: 'KodSpot Housekeeping',
    summary:
      'Digitised paper-based housekeeping for one of South India’s largest tertiary-care hospitals — multi-floor supervisor flows, photo-evidence cleaning records and AI-assisted shift analytics, deployed without disrupting clinical operations.',
    metrics: [
      { v: 'Multi-floor',   l: 'Supervisor workflow with floor-level rosters' },
      { v: 'Photo-verified',l: 'Cleaning evidence on every completed task' },
      { v: 'Zero paper',    l: 'Required for shift audit & compliance review' }
    ]
  },
  {
    slug: 'kle-hotel-management',
    title: 'Operations & menu digitisation for a hospitality institute',
    client: 'KLE Society’s Institute of Hotel Management',
    industry: 'Hospitality / Education',
    product: 'KodSpot Menu + Housekeeping',
    summary:
      'Branded QR menus for the institute’s training restaurants, plus a housekeeping rollout for student labs and guest-facing rooms — giving hospitality students a live, audited operations stack to learn on.',
    metrics: [
      { v: 'QR menus',     l: 'Branded, plan-gated, UPI-Pay enabled' },
      { v: 'Live audit',   l: 'Every cleaning + service action logged' },
      { v: 'Hands-on',     l: 'Students train on production-grade SaaS' }
    ]
  },
  {
    slug: 'kle-jnmc-electrical',
    title: 'Electrical reliability for a major medical campus',
    client: 'Electrical Department, JNMC (KLE Academy of Higher Education & Research)',
    industry: 'Healthcare Infrastructure',
    product: 'KodSpot Electrical',
    summary:
      'Replaced spreadsheet-based inspection with templated checklists, asset lifecycle tracking, automatic escalation rules and a public QR-complaint loop with verified resolution — across a hospital + medical-college campus where electrical uptime is clinically critical.',
    metrics: [
      { v: 'QR complaints', l: 'Public users → assigned engineer in seconds' },
      { v: 'Auto-escalate', l: 'Unresolved failures escalate by severity' },
      { v: 'Offline-ready', l: 'Field engineers continue during connectivity loss' }
    ]
  }
] as const;

// Logos / display names used on the homepage trust strip.
export const CLIENT_LOGOS = [
  { name: 'KLE Dr. Prabhakar Kore Hospital & MRC', short: 'KLE Hospital' },
  { name: 'KLE Society’s Institute of Hotel Management', short: 'KLE Hotel Management' },
  { name: 'JNMC — Electrical Department (KLE AHER)', short: 'JNMC Electrical' }
] as const;
