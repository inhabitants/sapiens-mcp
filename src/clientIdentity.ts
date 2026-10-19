// ============================================
// QUEM É O CLIENT — o motor que a pessoa usa do outro lado do MCP.
//
// O backend quer saber por onde um personagem nasceu ou foi ativado ("MCP
// (Claude)" em vez de "MCP (agente)" no alerta do dono). Dois transportes,
// duas fontes:
//   - stdio: o handshake `initialize` traz clientInfo {name, version} e o
//     Server do SDK guarda em getClientVersion(). É a fonte boa: "claude-ai",
//     "claude-code", "cursor", "gemini-cli"...
//   - remoto (streamable HTTP, stateless na Vercel): cada request é um Server
//     novo e o initialize não fica. Sobra o User-Agent do HTTP, que viaja com
//     o prefixo "ua:" pro backend saber que é pista, não nome.
// O valor cru vai pro backend, que rotula (convex/shared/characterOrigin.ts).
// Nunca é identidade: a identidade é sempre o bearer/login.
// ============================================
import { AsyncLocalStorage } from "node:async_hooks";

const MAX = 120;
const requestClient = new AsyncLocalStorage<string>();

/** Limpa o que veio de fora: uma linha, sem caractere de controle, teto de 120. */
export function sanitizeClientName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const clean = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return undefined;
  return clean.slice(0, MAX);
}

/** Embrulha a chamada com a pista do client (call do stdio ou request remota). */
export function runWithClientHint<T>(hint: unknown, fn: () => T): T {
  const clean = sanitizeClientName(hint);
  if (!clean) return fn();
  return requestClient.run(clean, fn);
}

/** A pista do client da chamada em curso, se houver. */
export function getClientName(): string | undefined {
  return requestClient.getStore();
}
