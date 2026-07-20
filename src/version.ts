import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Fonte ÚNICA da versão do MCP, lida do package.json do próprio binário em
 * runtime. Reflete o que está REALMENTE rodando (não um literal cravado no
 * código nem valor server-side), então flagra client preso em cache antigo do
 * npx. Tanto `dist/version.js` quanto `src/version.ts` ficam 1 nível acima do
 * package.json (../package.json), então o caminho bate em build E em dev (tsx).
 *
 * Antes disto a versão vivia em 3 literais independentes (package.json + 2 no
 * index.ts) sincronizados por um regex no release.sh — um bump off-path
 * dessincronizava em silêncio. Agora package.json é a única fonte.
 */
export function getMcpVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return typeof pkg?.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

export const MCP_VERSION = getMcpVersion();
