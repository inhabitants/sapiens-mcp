/**
 * Currículo PRO — o template da casa, fonte ÚNICA.
 *
 * Mora no pacote sapiens-mcp de propósito: o Lab web (apps/sapiens, rota
 * /experimentos/resume-builder) importa daqui via `sapiens-mcp/resume`, e a
 * tool sapiens_resume serve o MESMO gerador pra qualquer client MCP. Um
 * template, duas portas, zero drift.
 *
 * É código PURO (data -> string HTML): sem rede, sem backend, sem persistência.
 * A foto (`photo`) entra como data URI ou URL e vai DIRETO pro HTML gerado,
 * nunca é gravada em banco nenhum. No stdio ela nem sai da máquina da pessoa.
 *
 * Quatro modelos (`theme`): 'pro' e 'executivo' são a folha de duas colunas
 * (sidebar escura com foto, contato, chips e barras de idioma; coluna principal
 * com timeline de experiência), 'moderno' e 'minimal' são a folha clássica de
 * coluna única.
 */

export type ResumeTheme = "pro" | "executivo" | "moderno" | "minimal";

// A carta de apresentação mora ao lado e sai pela mesma porta (sapiens-mcp/resume).
export { generateCoverLetterHTML, type CoverLetterData } from "./coverLetter.js";

export type ResumeRenderOptions = {
  /** Modelo visual. Default 'pro'. */
  theme?: ResumeTheme;
  /** Sobrescreve a cor de destaque do modelo (hex 6 dígitos, ex '#0E7C66'). */
  accentColor?: string;
};

type ThemeSpec = {
  label: string;
  description: string;
  layout: "sidebar" | "classico";
  /** Query string do Google Fonts (só as famílias). */
  fontsQuery: string;
  displayFamily: string;
  bodyFamily: string;
  accent: string;
  /** Cores da coluna lateral (só nos modelos sidebar). */
  sidebarBg: string;
  sidebarText: string;
  sidebarMuted: string;
  pageBg: string;
  photoRadius: string;
};

export const RESUME_THEMES: Record<ResumeTheme, ThemeSpec> = {
  pro: {
    label: "PRO",
    description:
      "Duas colunas: sidebar verde-jade escura com foto, contato, chips e idiomas; principal com timeline de experiência. O visual de consultoria.",
    layout: "sidebar",
    fontsQuery: "family=Inter:wght@400;500;600;700;800",
    displayFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    bodyFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    accent: "#3E9C86",
    sidebarBg: "#17453C",
    sidebarText: "#F2F7F5",
    sidebarMuted: "#B9CCC6",
    pageBg: "#EFF2F1",
    photoRadius: "50%",
  },
  executivo: {
    label: "Executivo",
    description:
      "Duas colunas em grafite com detalhe bronze e nome em serifa. Sóbrio, direção e C-level.",
    layout: "sidebar",
    fontsQuery:
      "family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700",
    displayFamily: "'Fraunces', Georgia, 'Times New Roman', serif",
    bodyFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    accent: "#B08D57",
    sidebarBg: "#23262B",
    sidebarText: "#F4F2EE",
    sidebarMuted: "#B7B3AA",
    pageBg: "#F1F0ED",
    photoRadius: "50%",
  },
  moderno: {
    label: "Moderno",
    description:
      "Coluna única, foto no cabeçalho, roxo da casa. Direto e contemporâneo.",
    layout: "classico",
    fontsQuery:
      "family=Inter:wght@400;500;600;700&family=Sora:wght@600;700;800",
    displayFamily: "'Sora', 'Inter', -apple-system, sans-serif",
    bodyFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    accent: "#6C63FF",
    sidebarBg: "#1A1A2E",
    sidebarText: "#F2F2F7",
    sidebarMuted: "#B9B9C9",
    pageBg: "#F6F6F9",
    photoRadius: "22%",
  },
  minimal: {
    label: "Minimal",
    description:
      "Coluna única, preto no branco, filetes finos. Máximo de respiro, zero enfeite.",
    layout: "classico",
    fontsQuery: "family=Inter:wght@400;500;600;700;800",
    displayFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    bodyFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    accent: "#111111",
    sidebarBg: "#161616",
    sidebarText: "#F5F5F5",
    sidebarMuted: "#BBBBBB",
    pageBg: "#FFFFFF",
    photoRadius: "8px",
  },
};

const LABELS: Record<string, { pt: string; en: string }> = {
  summary: { pt: "Resumo Profissional", en: "Professional Summary" },
  experience: { pt: "Experiência Profissional", en: "Professional Experience" },
  contact: { pt: "Contacto", en: "Contact" },
  languages: { pt: "Idiomas", en: "Languages" },
  clients: { pt: "Clientes Selecionados", en: "Selected Clients" },
  education: { pt: "Educação", en: "Education" },
  skills: { pt: "Competências", en: "Skills" },
  grants: { pt: "Bolsas & Fomentos", en: "Grants" },
  awards: { pt: "Prémios & Honrarias", en: "Honors & Awards" },
  publications: { pt: "Publicações", en: "Publications" },
};

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return `rgba(62, 156, 134, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function escapeHtml(text: unknown): string {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Texto corrido (summary, bullets) aceita SÓ <em> e <strong>. O resto escapa.
 */
function sanitizeRichText(text: unknown): string {
  if (text === null || text === undefined) return "";
  return escapeHtml(text).replace(/&lt;(\/?)(em|strong)&gt;/gi, "<$1$2>");
}

/** Foto: data URI de imagem ou URL http(s). Fora disso, ignora em silêncio. */
function safePhotoSrc(photo: unknown): string | null {
  if (typeof photo !== "string") return null;
  const p = photo.trim();
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(p)) return p;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(p)) return p;
  return null;
}

/** Iniciais pro monograma quando não há foto (o "AF" no círculo). */
function monogram(name: unknown): string {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "CV";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

const ICONS: Record<string, string> = {
  location: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  phone: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  email: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
  linkedin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>`,
  portfolio: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 7h8M8 12h8M8 17h8"/></svg>`,
  website: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
};

type ContactEntry = { icon: string; content: string; url?: string };

function collectContacts(data: any): ContactEntry[] {
  const out: ContactEntry[] = [];
  if (data.location) out.push({ icon: "location", content: data.location });
  if (data.phone) out.push({ icon: "phone", content: data.phone });
  if (data.email) out.push({ icon: "email", content: data.email, url: `mailto:${data.email}` });
  if (data.linkedin?.url) out.push({ icon: "linkedin", content: data.linkedin.label || data.linkedin.url, url: data.linkedin.url });
  if (data.portfolio?.url) out.push({ icon: "portfolio", content: data.portfolio.label || data.portfolio.url, url: data.portfolio.url });
  if (data.website?.url) out.push({ icon: "website", content: data.website.label || data.website.url, url: data.website.url });
  return out;
}

function renderContact(entry: ContactEntry): string {
  const iconSvg = ICONS[entry.icon] || ICONS.website;
  const inner = entry.url
    ? `<a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener">${escapeHtml(entry.content)}</a>`
    : escapeHtml(entry.content);
  return `<span class="contact-item">${iconSvg} ${inner}</span>`;
}

/* ============================================================
   CSS
   ============================================================ */

function buildCss(spec: ThemeSpec, accent: string): string {
  const isSidebar = spec.layout === "sidebar";
  const accentSoft = hexToRgba(accent, 0.09);
  const accentBorder = hexToRgba(accent, 0.18);
  const sidebarChipBg = "rgba(255, 255, 255, 0.09)";
  const sidebarChipBorder = "rgba(255, 255, 255, 0.13)";
  const sidebarRule = "rgba(255, 255, 255, 0.14)";
  // Na sidebar escura o accent puro pode ficar apagado; clareia levemente.
  const accentOnDark = hexToRgba(accent, 1).replace("rgba(", "rgba(").replace(", 1)", ", 1)");

  const base = `
:root {
  --bg: ${spec.pageBg};
  --surface: #FFFFFF;
  --ink: #1B1E23;
  --ink-2: #4A4E57;
  --ink-3: #82868E;
  --border: #E5E6E8;
  --border-light: #F0F0F2;
  --accent: ${accent};
  --accent-soft: ${accentSoft};
  --accent-border: ${accentBorder};
  --tag-bg: #F3F4F4;
  --tag-text: #45484E;
  --sidebar-bg: ${spec.sidebarBg};
  --sidebar-text: ${spec.sidebarText};
  --sidebar-muted: ${spec.sidebarMuted};
  --sidebar-accent: ${accentOnDark};
  --font-display: ${spec.displayFamily};
  --font-body: ${spec.bodyFamily};
  --photo-radius: ${spec.photoRadius};
}

*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

html {
  font-size: 15.5px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

body {
  font-family: var(--font-body);
  color: var(--ink);
  background-color: var(--bg);
  line-height: 1.6;
  padding: 2.2rem 1rem;
  font-feature-settings: "kern" 1, "liga" 1;
}

a { color: var(--accent); text-decoration: none; }
a:hover { opacity: .72; }

.sheet {
  max-width: 880px;
  margin: 0 auto;
  background: var(--surface);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(20, 22, 27, .05), 0 14px 44px rgba(20, 22, 27, .09);
}

/* ---- Rótulo de seção: filete curto + caixa alta espaçada ---- */
.sec-label {
  display: flex;
  align-items: center;
  gap: .65rem;
  font-size: .72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .16em;
  color: var(--ink);
  margin-bottom: 1rem;
}
.sec-label::before {
  content: '';
  width: 22px;
  height: 3px;
  border-radius: 2px;
  background: var(--accent);
  flex-shrink: 0;
}

.main-section { margin-bottom: 1.9rem; }
.main-section:last-child { margin-bottom: 0; }

.summary-text {
  font-size: .86rem;
  color: var(--ink-2);
  line-height: 1.75;
  max-width: 70ch;
}
.summary-text em { font-style: italic; color: var(--ink); font-weight: 500; }
.summary-text strong { font-weight: 600; color: var(--ink); }

/* ---- Experiência: timeline com pino + pílula de período ---- */
.xp { position: relative; padding-left: 1.35rem; }
.xp::before {
  content: '';
  position: absolute;
  left: 5px; top: 10px; bottom: 6px;
  width: 1px;
  background: var(--border);
}
.xp-item { position: relative; margin-bottom: 1.5rem; }
.xp-item:last-child { margin-bottom: 0; }
.xp-item::before {
  content: '';
  position: absolute;
  left: -1.35rem; top: 5px;
  width: 9px; height: 9px;
  border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--accent);
}
.xp-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: .5rem 1rem;
  margin-bottom: .15rem;
}
.xp-role { font-size: .95rem; font-weight: 700; letter-spacing: -0.01em; line-height: 1.3; }
.xp-company { display: block; font-size: .8rem; font-weight: 600; color: var(--accent); margin-top: 1px; }
.xp-company a { color: var(--accent); }
.xp-period {
  font-size: .7rem;
  font-weight: 600;
  color: var(--ink-3);
  background: var(--tag-bg);
  padding: 3px 10px;
  border-radius: 5px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  margin-top: 2px;
}
.xp-location { font-size: .74rem; color: var(--ink-3); margin-bottom: .35rem; }
.xp-note {
  font-size: .72rem;
  font-style: italic;
  color: var(--ink-3);
  margin: .2rem 0 .35rem;
  padding: 4px 10px;
  background: var(--tag-bg);
  border-radius: 5px;
  display: inline-block;
}
.xp-bullets { list-style: none; margin-top: .45rem; }
.xp-bullets li {
  font-size: .8rem;
  color: var(--ink-2);
  line-height: 1.6;
  padding-left: 1.05rem;
  position: relative;
  margin-bottom: .4rem;
}
.xp-bullets li::before {
  content: '';
  position: absolute;
  left: 1px; top: 8px;
  width: 5px; height: 5px;
  border-radius: 50%;
  background: ${hexToRgba(accent, 0.55)};
}
.xp-bullets li strong { font-weight: 600; color: var(--ink); }
.xp-bullets li em { font-style: italic; }

.xp-divider { display: flex; align-items: center; gap: 1rem; margin: 1.4rem 0; }
.xp-divider .line { flex: 1; height: 1px; background: var(--border); }
.xp-divider .label {
  font-size: .66rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: var(--ink-3);
  white-space: nowrap;
}

/* ---- Educação ---- */
.edu-list { list-style: none; }
.edu-list li {
  padding: .55rem 0;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: .6rem 1rem;
  flex-wrap: wrap;
}
.edu-list li:last-child { border-bottom: none; }
.edu-main { font-size: .84rem; color: var(--ink-2); min-width: 0; }
.edu-main strong { font-weight: 600; color: var(--ink); display: block; line-height: 1.35; }
.edu-sub { font-size: .76rem; color: var(--ink-3); }
.edu-year {
  font-size: .7rem;
  font-weight: 600;
  color: var(--ink-3);
  background: var(--tag-bg);
  padding: 3px 10px;
  border-radius: 5px;
  white-space: nowrap;
  flex-shrink: 0;
}
.edu-badge {
  font-size: .66rem;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 2px 9px;
  border-radius: 100px;
  white-space: nowrap;
}

/* ---- Chips de skill (coluna principal, layout clássico) ---- */
.skills-group { margin-bottom: .95rem; }
.skills-group:last-child { margin-bottom: 0; }
.skills-group-title {
  font-size: .68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .09em;
  color: var(--ink-3);
  margin-bottom: .45rem;
}
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  font-size: .72rem;
  font-weight: 500;
  color: var(--tag-text);
  background: var(--tag-bg);
  padding: 4px 12px;
  border-radius: 6px;
  white-space: nowrap;
}
.chip--accent {
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid var(--accent-border);
}

/* ---- Idiomas com barra ---- */
.langs { list-style: none; }
.langs li { margin-bottom: .7rem; }
.langs li:last-child { margin-bottom: 0; }
.lang-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  font-size: .78rem;
  margin-bottom: .3rem;
}
.lang-name { font-weight: 600; }
.lang-level { font-size: .72rem; color: var(--ink-3); }
.lang-bar { height: 4px; border-radius: 3px; background: var(--border-light); overflow: hidden; }
.lang-bar > span { display: block; height: 100%; border-radius: 3px; background: var(--accent); }

/* ---- Listas auxiliares ---- */
.plain-list { list-style: none; }
.plain-list li {
  font-size: .8rem;
  color: var(--ink-2);
  padding: .22rem 0 .22rem 1.1rem;
  position: relative;
  line-height: 1.6;
}
.plain-list li strong { font-weight: 600; color: var(--ink); }
.plain-list.diamonds li::before {
  content: '◆';
  position: absolute; left: 0; top: 7px;
  color: var(--accent);
  font-size: 7px;
  opacity: .65;
}
.plain-list.arrows li::before {
  content: '→';
  position: absolute; left: 0;
  color: var(--ink-3);
  font-size: .78rem;
}
.plain-list li em { font-style: italic; color: var(--ink-3); }

.clients-line { font-size: .84rem; color: var(--ink-2); line-height: 1.8; letter-spacing: .02em; }

.closing-quote { text-align: center; padding-top: 1.4rem; border-top: 1px solid var(--border-light); }
.closing-quote p { font-style: italic; font-size: .86rem; color: var(--ink-2); }
.closing-quote span {
  display: block;
  margin-top: .3rem;
  font-style: normal;
  font-size: .66rem;
  color: var(--ink-3);
  letter-spacing: .06em;
  text-transform: uppercase;
}
.sheet-footer {
  padding: 1.1rem 2.4rem;
  text-align: center;
  font-size: .7rem;
  color: var(--ink-3);
  background: var(--bg);
}
.sheet-footer a { font-weight: 500; }
`;

  const sidebarCss = `
/* ============ LAYOUT DUAS COLUNAS ============ */
.sheet { display: grid; grid-template-columns: 300px 1fr; }
.side {
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  padding: 2.6rem 1.9rem 2.2rem;
}
.main { padding: 2.6rem 2.5rem 2.4rem; min-width: 0; }

.side a { color: var(--sidebar-text); }
.side a:hover { opacity: .8; }

.side-photo-wrap { display: flex; justify-content: center; margin-bottom: 1.5rem; }
.side-photo {
  width: 128px; height: 128px;
  object-fit: cover;
  border-radius: var(--photo-radius);
  border: 2px solid rgba(255, 255, 255, .35);
  outline: 6px solid rgba(255, 255, 255, .06);
}
.side-monogram {
  width: 128px; height: 128px;
  border-radius: var(--photo-radius);
  border: 2px solid ${hexToRgba(accent, 0.75)};
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 500;
  letter-spacing: .12em;
  color: var(--sidebar-text);
}
.side-name {
  font-family: var(--font-display);
  text-align: center;
  font-size: 1.55rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
  margin-bottom: .45rem;
}
.side-title {
  text-align: center;
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--sidebar-accent);
  line-height: 1.6;
  margin-bottom: 1.9rem;
}

.side-label {
  font-size: .68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .16em;
  color: var(--sidebar-accent);
  padding-bottom: .45rem;
  border-bottom: 1px solid ${sidebarRule};
  margin-bottom: .8rem;
}
.side-section { margin-bottom: 1.7rem; }
.side-section:last-child { margin-bottom: 0; }

.side .contact-item {
  display: flex;
  align-items: flex-start;
  gap: .55rem;
  font-size: .76rem;
  color: var(--sidebar-text);
  margin-bottom: .55rem;
  line-height: 1.45;
  word-break: break-word;
}
.side .contact-item svg { width: 13px; height: 13px; flex-shrink: 0; margin-top: 3px; opacity: .75; }

.side-highlight {
  background: rgba(255, 255, 255, .07);
  border: 1px solid ${sidebarChipBorder};
  border-left: 3px solid var(--sidebar-accent);
  border-radius: 7px;
  padding: .65rem .8rem;
  margin-top: .9rem;
}
.side-highlight strong { display: block; font-size: .74rem; font-weight: 600; margin-bottom: .15rem; }
.side-highlight p { font-size: .7rem; color: var(--sidebar-muted); line-height: 1.5; }

.side .chips { gap: 6px; }
.side .chip {
  background: ${sidebarChipBg};
  border: 1px solid ${sidebarChipBorder};
  color: var(--sidebar-text);
  font-weight: 500;
  border-radius: 6px;
}
.side .skills-group-title { color: var(--sidebar-muted); }

.side .langs .lang-name { color: var(--sidebar-text); }
.side .langs .lang-level { color: var(--sidebar-muted); }
.side .lang-bar { background: rgba(255, 255, 255, .14); }
.side .lang-bar > span { background: var(--sidebar-accent); }

.side-lab {
  margin-top: 1rem;
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  padding: 5px 12px;
  background: rgba(255, 255, 255, .07);
  border: 1px solid ${sidebarChipBorder};
  border-radius: 100px;
  font-size: .62rem;
  font-weight: 600;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--sidebar-muted);
}
.side-lab i { width: 6px; height: 6px; border-radius: 50%; background: var(--sidebar-accent); }

@media (max-width: 680px) {
  body { padding: .5rem; }
  .sheet { grid-template-columns: 1fr; border-radius: 0; }
  .side { padding: 2rem 1.4rem; }
  .main { padding: 1.8rem 1.4rem; }
}

@media print {
  @page { margin: 0; size: A4; }
  html { font-size: 12.5px; }
  body { padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: 100%; border-radius: 0; box-shadow: none; grid-template-columns: 33% 1fr; }
  .side { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .main { padding: 2rem 1.8rem; }
  .xp-item, .edu-list li, .skills-group, .langs li { break-inside: avoid; }
  .sec-label { break-after: avoid; }
  a[href]::after { content: none; }
  .sheet-footer { display: none; }
  .no-print { display: none !important; }
}
`;

  const classicCss = `
/* ============ LAYOUT CLÁSSICO (coluna única) ============ */
.head {
  padding: 2.8rem 2.6rem 1.8rem;
  border-bottom: 1px solid var(--border);
  position: relative;
}
.head::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent), ${hexToRgba(accent, 0.45)}, var(--accent));
}
.head-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 1.5rem; }
.head-identity { min-width: 0; }
.head-photo {
  width: 96px; height: 96px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: var(--photo-radius);
  border: 1px solid var(--border);
  box-shadow: 0 2px 10px rgba(20, 22, 27, .08);
}
.head-name {
  font-family: var(--font-display);
  font-size: 2.3rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.08;
  margin-bottom: .35rem;
}
.head-title { font-size: 1.05rem; color: var(--ink-2); letter-spacing: -0.01em; margin-bottom: 1rem; }
.head-title strong { font-weight: 600; color: var(--accent); }
.head-meta { display: flex; flex-wrap: wrap; gap: .45rem 1.3rem; font-size: .78rem; color: var(--ink-3); }
.head-meta .contact-item { display: flex; align-items: center; gap: .35rem; }
.head-meta .contact-item svg { width: 13px; height: 13px; flex-shrink: 0; opacity: .8; }
.head-highlight {
  margin-top: 1rem;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  border-radius: 7px;
  padding: .55rem .85rem;
  max-width: 46ch;
}
.head-highlight strong { display: block; font-size: .74rem; font-weight: 600; }
.head-highlight p { font-size: .7rem; color: var(--ink-3); line-height: 1.5; }
.head-lab {
  margin-top: 1rem;
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  padding: 5px 14px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  border-radius: 100px;
  font-size: .66rem;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: .05em;
  text-transform: uppercase;
}
.head-lab i { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); opacity: .6; }

.main { padding: 2rem 2.6rem 2.2rem; }
.langs { max-width: 380px; }

@media (max-width: 640px) {
  body { padding: .5rem; }
  .sheet { border-radius: 0; }
  .head, .main { padding-left: 1.4rem; padding-right: 1.4rem; }
  .head-name { font-size: 1.8rem; }
  .head-row { flex-direction: column-reverse; }
  .head-photo { width: 76px; height: 76px; }
  .xp-head { flex-direction: column; gap: .15rem; }
}

@media print {
  @page { margin: 0.55in; size: A4; }
  html { font-size: 13px; }
  body { padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: 100%; border-radius: 0; box-shadow: none; }
  .head, .main { padding-left: 0; padding-right: 0; }
  .head { padding-top: .4rem; }
  .xp-item, .edu-list li, .skills-group, .langs li { break-inside: avoid; }
  .sec-label { break-after: avoid; }
  a { color: var(--accent) !important; }
  a[href]::after { content: none; }
  .sheet-footer { display: none; }
  .no-print { display: none !important; }
}
`;

  return base + (isSidebar ? sidebarCss : classicCss);
}

/* ============================================================
   Renderers de seção (compartilhados entre os dois layouts)
   ============================================================ */

function renderExperience(data: any, L: (k: string) => string): string {
  if (!Array.isArray(data.experience) || data.experience.length === 0) return "";
  let inner = "";
  for (const era of data.experience) {
    if (era.era) {
      inner += `
      <div class="xp-divider"><span class="line"></span><span class="label">${escapeHtml(era.era)}</span><span class="line"></span></div>`;
    }
    for (const item of era.items || []) {
      const companyInner = item.companyUrl
        ? `<a href="${escapeHtml(item.companyUrl)}" target="_blank" rel="noopener">${escapeHtml(item.company)}</a>`
        : escapeHtml(item.company);
      const bullets = (item.bullets || [])
        .map((b: any) => `<li>${sanitizeRichText(typeof b === "string" ? b : b?.text)}</li>`)
        .join("\n");
      inner += `
      <div class="xp-item">
        <div class="xp-head">
          <div>
            <h3 class="xp-role">${escapeHtml(item.role)}</h3>
            <span class="xp-company">${companyInner}</span>
          </div>
          ${item.period ? `<span class="xp-period">${escapeHtml(item.period)}</span>` : ""}
        </div>
        ${item.location ? `<p class="xp-location">${escapeHtml(item.location)}</p>` : ""}
        ${item.note ? `<span class="xp-note">${escapeHtml(item.note)}</span>` : ""}
        ${bullets ? `<ul class="xp-bullets">${bullets}</ul>` : ""}
      </div>`;
    }
  }
  return `
    <section class="main-section">
      <p class="sec-label">${L("experience")}</p>
      <div class="xp">${inner}</div>
    </section>`;
}

function renderEducation(data: any, L: (k: string) => string): string {
  if (!Array.isArray(data.education) || data.education.length === 0) return "";
  const items = data.education
    .map((edu: any) => {
      const badge = edu.badge ? ` <span class="edu-badge">${escapeHtml(edu.badge)}</span>` : "";
      const subtitle = edu.subtitle ? `<span class="edu-sub">${escapeHtml(edu.subtitle)}</span>` : "";
      return `<li>
        <div class="edu-main"><strong>${escapeHtml(edu.title)}${badge}</strong>${escapeHtml(edu.institution)}${subtitle ? "<br>" : ""}${subtitle}</div>
        ${edu.year ? `<span class="edu-year">${escapeHtml(edu.year)}</span>` : ""}
      </li>`;
    })
    .join("\n");
  return `
    <section class="main-section">
      <p class="sec-label">${L("education")}</p>
      <ul class="edu-list">${items}</ul>
    </section>`;
}

function renderSkillsGroups(data: any): string {
  if (!Array.isArray(data.skills) || data.skills.length === 0) return "";
  return data.skills
    .map((group: any) => {
      const tags = (group.tags || [])
        .map((t: any) => `<span class="chip${t?.accent ? " chip--accent" : ""}">${escapeHtml(t?.name ?? t)}</span>`)
        .join("\n");
      return `
      <div class="skills-group">
        <p class="skills-group-title">${escapeHtml(group.group)}</p>
        <div class="chips">${tags}</div>
      </div>`;
    })
    .join("\n");
}

function renderLanguages(data: any): string {
  if (!Array.isArray(data.languages) || data.languages.length === 0) return "";
  return `<ul class="langs">${data.languages
    .map((l: any) => {
      const pct = Math.max(8, Math.min(100, Number(l?.pct) || 65));
      return `<li>
        <div class="lang-row"><span class="lang-name">${escapeHtml(l?.name)}</span><span class="lang-level">${escapeHtml(l?.level ?? "")}</span></div>
        <div class="lang-bar"><span style="width: ${pct}%"></span></div>
      </li>`;
    })
    .join("\n")}</ul>`;
}

function renderTail(data: any, L: (k: string) => string): string {
  let out = "";
  if (data.clients) {
    out += `
    <section class="main-section">
      <p class="sec-label">${L("clients")}</p>
      <p class="clients-line">${escapeHtml(data.clients)}</p>
    </section>`;
  }
  const simple = (key: "grants" | "awards") => {
    const arr = data[key];
    if (!Array.isArray(arr) || arr.length === 0) return;
    const items = arr
      .map((a: any) => {
        const name = a.url
          ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.name)}</a>`
          : `<strong>${escapeHtml(a.name)}</strong>`;
        return `<li>${name}${a.detail ? ` · ${escapeHtml(a.detail)}` : ""}</li>`;
      })
      .join("\n");
    out += `
    <section class="main-section">
      <p class="sec-label">${L(key)}</p>
      <ul class="plain-list diamonds">${items}</ul>
    </section>`;
  };
  simple("grants");
  simple("awards");
  if (Array.isArray(data.publications) && data.publications.length > 0) {
    const items = data.publications
      .map((p: any) => {
        const title = p.url
          ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a>`
          : escapeHtml(p.title);
        return `<li>${title}${p.note ? ` <em>· ${escapeHtml(p.note)}</em>` : ""}</li>`;
      })
      .join("\n");
    out += `
    <section class="main-section">
      <p class="sec-label">${L("publications")}</p>
      <ul class="plain-list arrows">${items}</ul>
    </section>`;
  }
  if (data.closingQuote) {
    out += `
    <div class="closing-quote">
      <p>"${escapeHtml(data.closingQuote.text)}"<span>${escapeHtml(data.closingQuote.author)}</span></p>
    </div>`;
  }
  return out;
}

function renderFooter(data: any): string {
  if (!data.footer) return "";
  const links = data.footer.links
    ? " · " + data.footer.links.map((l: any) => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join(" · ")
    : "";
  return `<footer class="sheet-footer">${escapeHtml(data.footer.name)}${links}</footer>`;
}

/* ============================================================
   Documento
   ============================================================ */

/**
 * Gera o documento HTML completo do currículo a partir dos dados estruturados.
 * `data` segue o shape documentado em RESUME_SCHEMA_DESCRIPTION.
 */
export function generateResumeHTML(
  data: any,
  options: ResumeRenderOptions = {},
): string {
  const theme: ResumeTheme =
    options.theme && RESUME_THEMES[options.theme] ? options.theme : "pro";
  const spec = RESUME_THEMES[theme];
  const rawAccent = options.accentColor?.trim();
  const accent =
    rawAccent && /^#?[0-9a-f]{6}$/i.test(rawAccent)
      ? rawAccent.startsWith("#")
        ? rawAccent
        : `#${rawAccent}`
      : spec.accent;
  const lang: "pt" | "en" = data?.lang === "pt" ? "pt" : "en";
  const L = (key: string) => LABELS[key]?.[lang] ?? LABELS[key]?.en ?? key;

  const contacts = collectContacts(data);
  const photoSrc = safePhotoSrc(data.photo);
  const titleHtml = data.titleHighlight
    ? `${escapeHtml(data.title)} · <strong>${escapeHtml(data.titleHighlight)}</strong>`
    : escapeHtml(data.title);

  const summaryHtml = data.summary
    ? `
    <section class="main-section">
      <p class="sec-label">${L("summary")}</p>
      <p class="summary-text">${sanitizeRichText(data.summary)}</p>
    </section>`
    : "";

  const mainCore =
    summaryHtml +
    renderExperience(data, L) +
    renderEducation(data, L) +
    renderTail(data, L);

  let bodyHtml = "";

  if (spec.layout === "sidebar") {
    const photoHtml = photoSrc
      ? `<img class="side-photo" src="${escapeHtml(photoSrc)}" alt="${escapeHtml(data.name)}" />`
      : `<div class="side-monogram">${escapeHtml(monogram(data.name))}</div>`;

    const highlightHtml = data.highlight
      ? `<div class="side-highlight"><strong>${escapeHtml(data.highlight.title)}</strong><p>${escapeHtml(data.highlight.text)}</p></div>`
      : "";

    const labHtml = data.labBadge
      ? `<div class="side-lab"><i></i>${escapeHtml(data.labBadge.text)}${data.labBadge.url ? `&nbsp;<a href="${escapeHtml(data.labBadge.url)}" target="_blank" rel="noopener">${escapeHtml(data.labBadge.urlLabel || data.labBadge.url)}</a>` : ""}</div>`
      : "";

    const skillsSide = renderSkillsGroups(data);
    const langsSide = renderLanguages(data);

    bodyHtml = `
    <div class="sheet">
      <aside class="side">
        <div class="side-photo-wrap">${photoHtml}</div>
        <h1 class="side-name">${escapeHtml(data.name)}</h1>
        <p class="side-title">${titleHtml}</p>
        ${
          contacts.length > 0
            ? `<div class="side-section"><p class="side-label">${L("contact")}</p>${contacts.map(renderContact).join("\n")}${highlightHtml}</div>`
            : highlightHtml
        }
        ${skillsSide ? `<div class="side-section"><p class="side-label">${L("skills")}</p>${skillsSide}</div>` : ""}
        ${langsSide ? `<div class="side-section"><p class="side-label">${L("languages")}</p>${langsSide}</div>` : ""}
        ${labHtml}
      </aside>
      <div class="main">
        ${mainCore}
      </div>
    </div>
    ${renderFooter(data)}`;
  } else {
    const photoHtml = photoSrc
      ? `<img class="head-photo" src="${escapeHtml(photoSrc)}" alt="${escapeHtml(data.name)}" />`
      : "";
    const highlightHtml = data.highlight
      ? `<div class="head-highlight"><strong>${escapeHtml(data.highlight.title)}</strong><p>${escapeHtml(data.highlight.text)}</p></div>`
      : "";
    const labHtml = data.labBadge
      ? `<div class="head-lab"><i></i>${
          data.labBadge.url
            ? `${escapeHtml(data.labBadge.text)}: <a href="${escapeHtml(data.labBadge.url)}" target="_blank" rel="noopener">${escapeHtml(data.labBadge.urlLabel || data.labBadge.url)}</a>`
            : escapeHtml(data.labBadge.text)
        }</div>`
      : "";
    const skillsMain = renderSkillsGroups(data);
    const langsMain = renderLanguages(data);

    bodyHtml = `
    <div class="sheet">
      <header class="head">
        <div class="head-row">
          <div class="head-identity">
            <h1 class="head-name">${escapeHtml(data.name)}</h1>
            <p class="head-title">${titleHtml}</p>
            <div class="head-meta">${contacts.map(renderContact).join("\n")}</div>
            ${highlightHtml}
            ${labHtml}
          </div>
          ${photoHtml}
        </div>
      </header>
      <div class="main">
        ${summaryHtml}
        ${renderExperience(data, L)}
        ${renderEducation(data, L)}
        ${skillsMain ? `<section class="main-section"><p class="sec-label">${L("skills")}</p>${skillsMain}</section>` : ""}
        ${langsMain ? `<section class="main-section"><p class="sec-label">${L("languages")}</p>${langsMain}</section>` : ""}
        ${renderTail(data, L)}
      </div>
    </div>
    ${renderFooter(data)}`;
  }

  return `<!DOCTYPE html>
<html lang="${lang === "pt" ? "pt-BR" : "en"}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(data.name)} · ${escapeHtml(data.title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?${spec.fontsQuery}&display=swap" rel="stylesheet">
    <style>${buildCss(spec, accent)}</style>
</head>
<body class="theme-${theme}">
${bodyHtml}
</body>
</html>`;
}

/**
 * O contrato de dados, em texto, pra quem monta o JSON (o Gemini do Lab web e
 * qualquer agente via MCP leem a MESMA descrição).
 */
export const RESUME_SCHEMA_DESCRIPTION = `
{
  "lang": "pt" ou "en" (idioma dos títulos de seção; use o idioma do conteúdo),
  "name": "Full Name",
  "title": "Professional Title (e.g., Software Engineer)",
  "titleHighlight": "Specialty highlight (e.g., AI & Machine Learning)",
  "location": "City, Country",
  "phone": "+1 555 123 4567",
  "email": "user@email.com",
  "linkedin": { "url": "https://linkedin.com/in/user", "label": "linkedin.com/in/user" },
  "portfolio": { "url": "https://portfolio.com", "label": "portfolio.com" },
  "website": { "url": "https://site.com", "label": "site.com" },
  "summary": "Professional summary with <em>italic</em> and <strong>bold</strong> for emphasis.",
  "highlight": { "title": "Work Permit", "text": "Short callout shown near the contact info (visa, availability, relocation...)" },
  "experience": [
    {
      "era": "Current Phase (optional divider label)",
      "items": [
        {
          "role": "Job Title",
          "company": "Company Name",
          "companyUrl": "https://company.com",
          "period": "2022 - Present",
          "location": "Remote",
          "note": "Optional context note",
          "bullets": [
            "<strong>Achievement:</strong> Description of what was accomplished.",
            "<strong>Project:</strong> Details about a key project."
          ]
        }
      ]
    }
  ],
  "clients": "Client A · Client B · Client C",
  "education": [
    { "title": "B.S. Computer Science", "institution": "MIT", "year": "2020", "badge": "Honors", "subtitle": "Focus: AI" }
  ],
  "skills": [
    {
      "group": "Core",
      "tags": [
        { "name": "React", "accent": true },
        { "name": "Node.js", "accent": true },
        { "name": "Python" }
      ]
    }
  ],
  "languages": [
    { "name": "Português", "level": "Nativo", "pct": 100 },
    { "name": "Inglês", "level": "Fluente", "pct": 88 }
  ],
  "grants": [{ "name": "Google Cloud Credits", "url": "https://cloud.google.com" }],
  "awards": [{ "name": "Best Project 2023", "detail": "University competition", "url": "" }],
  "publications": [{ "title": "My Article", "url": "https://medium.com/article", "note": "featured" }],
  "closingQuote": { "text": "An inspiring quote", "author": "Author Name" },
  "footer": { "name": "Full Name", "links": [{ "label": "Portfolio", "url": "https://portfolio.com" }] }
}
Nota: "photo" (data URI ou URL https) é aceito no render, mas NUNCA é coletado
pelo chat nem gravado em banco: quem anexa é o cliente, localmente. "pct" dos
idiomas é 0-100 (barra). Modelos: pro | executivo (duas colunas com sidebar),
moderno | minimal (coluna única).`;
