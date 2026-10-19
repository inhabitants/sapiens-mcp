import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A extensão do Claude Desktop (.mcpb) é um arquivo só, gerado pelo esbuild, e
// não carrega package.json: o scripts/mcpb.mjs grava a versão aqui na hora do
// build (--define). No pacote do npm o identificador não existe, e o typeof
// dele é "undefined" sem estourar.
declare const __SAPIENS_MCP_VERSION__: string | undefined;

/**
 * Fonte ÚNICA da versão do MCP, lida do package.json do próprio binário em
 * runtime. Reflete o que está REALMENTE rodando (não um literal cravado no
 * código nem valor server-side), então flagra client preso em cache antigo do
 * npx. Tanto `dist/version.js` quanto `src/version.ts` ficam 1 nível acima do
 * package.json (../package.json), então o caminho bate em build E em dev (tsx).
 *
 * Antes disto a versão vivia em 3 literais independentes (package.json + 2 no
 * index.ts) sincronizados por um regex no release.sh — um bump off-path
 * dessincronizava em silêncio. Agora package.json é a única fonte (a extensão
 * recebe o mesmo número, copiado dele no build).
 */
export function getMcpVersion(): string {
  if (typeof __SAPIENS_MCP_VERSION__ === "string") return __SAPIENS_MCP_VERSION__;
  try {
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return typeof pkg?.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

export const MCP_VERSION = getMcpVersion();
