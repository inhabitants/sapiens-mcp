/**
 * Carta de apresentação — o template irmão do Currículo PRO.
 *
 * Mesma casa do currículo (fonte única no pacote, código puro data -> HTML,
 * nada persiste em servidor): recebe o TEXTO estruturado que a IA (ou a
 * pessoa) escreveu + os dados de identidade do currículo, e devolve uma folha
 * A4 de uma página na mesma linha visual do tema escolhido. O PDF sai igual ao
 * do currículo: abrir no navegador e salvar como PDF.
 */

import { RESUME_THEMES, type ResumeTheme } from "./template.js";

export type CoverLetterData = {
  /** Idioma do rótulo de data e do título do documento. */
  language?: "pt" | "en";
  /** Assunto opcional (ex: "Candidatura: Analista de Conteúdo"). */
  subject?: string;
  greeting: string;
  paragraphs: string[];
  closing: string;
  /** Data por extenso, formatada por quem chama (código puro não lê relógio). */
  dateLine?: string;
};

function escapeHtml(text: unknown): string {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function contactLine(resume: any): string {
  return [resume.location, resume.phone, resume.email, resume.linkedin?.label]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
}

/**
 * Gera o documento HTML completo da carta. `resume` é o mesmo objeto do
 * currículo (só identidade/contato são lidos); `theme` casa a carta com a
 * folha escolhida.
 */
export function generateCoverLetterHTML(
  cover: CoverLetterData,
  resume: any,
  options: { theme?: ResumeTheme } = {},
): string {
  const theme: ResumeTheme =
    options.theme && RESUME_THEMES[options.theme] ? options.theme : "pro";
  const spec = RESUME_THEMES[theme];
  const lang = cover.language === "en" ? "en" : "pt";
  const title = lang === "en" ? "Cover Letter" : "Carta de Apresentação";

  const paragraphs = (cover.paragraphs || [])
    .map((p) => `<p class="body-p">${escapeHtml(p)}</p>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="${lang === "en" ? "en" : "pt-BR"}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(resume.name)} · ${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?${spec.fontsQuery}&display=swap" rel="stylesheet">
    <style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html { font-size: 15.5px; -webkit-font-smoothing: antialiased; }
body {
  font-family: ${spec.bodyFamily};
  color: #1B1E23;
  background: ${spec.pageBg};
  line-height: 1.6;
  padding: 2.2rem 1rem;
}
.sheet {
  max-width: 760px;
  margin: 0 auto;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(20,22,27,.05), 0 14px 44px rgba(20,22,27,.09);
  padding: 3rem 3.2rem 2.6rem;
  position: relative;
}
.sheet::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: ${spec.accent};
}
.head { border-bottom: 1px solid #E5E6E8; padding-bottom: 1.2rem; margin-bottom: 1.6rem; }
.head-name {
  font-family: ${spec.displayFamily};
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: .15rem;
}
.head-title {
  font-size: .78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .14em;
  color: ${spec.accent};
  margin-bottom: .55rem;
}
.head-contact { font-size: .76rem; color: #82868E; }
.doc-label {
  font-size: .68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .16em;
  color: #82868E;
  display: flex;
  align-items: center;
  gap: .65rem;
  margin-bottom: 1.2rem;
}
.doc-label::before { content: ''; width: 22px; height: 3px; border-radius: 2px; background: ${spec.accent}; }
.date-line { font-size: .8rem; color: #82868E; margin-bottom: 1.4rem; }
.subject { font-size: .92rem; font-weight: 700; margin-bottom: 1.2rem; }
.greeting { font-size: .9rem; margin-bottom: 1rem; }
.body-p { font-size: .88rem; color: #4A4E57; line-height: 1.8; margin-bottom: 1rem; text-align: justify; }
.closing { margin-top: 1.6rem; font-size: .9rem; }
.signature {
  margin-top: .4rem;
  font-family: ${spec.displayFamily};
  font-size: 1.05rem;
  font-weight: 700;
}
@media (max-width: 640px) {
  body { padding: .5rem; }
  .sheet { border-radius: 0; padding: 1.8rem 1.4rem; }
}
@media print {
  @page { margin: 0.7in; size: A4; }
  html { font-size: 13px; }
  body { padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: 100%; border-radius: 0; box-shadow: none; padding: 0; }
  .sheet::before { display: none; }
  .body-p { break-inside: avoid; }
}
    </style>
</head>
<body>
    <div class="sheet">
        <header class="head">
            <h1 class="head-name">${escapeHtml(resume.name)}</h1>
            ${resume.title ? `<p class="head-title">${escapeHtml(resume.title)}</p>` : ""}
            <p class="head-contact">${contactLine(resume)}</p>
        </header>
        <p class="doc-label">${title}</p>
        ${cover.dateLine ? `<p class="date-line">${escapeHtml(cover.dateLine)}</p>` : ""}
        ${cover.subject ? `<p class="subject">${escapeHtml(cover.subject)}</p>` : ""}
        <p class="greeting">${escapeHtml(cover.greeting)}</p>
        ${paragraphs}
        <p class="closing">${escapeHtml(cover.closing)}</p>
        <p class="signature">${escapeHtml(resume.name)}</p>
    </div>
</body>
</html>`;
}
