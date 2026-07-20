import { z } from "zod";

/**
 * Guard de arg obrigatório-por-action (os schemas são um z.object só por tool,
 * então "obrigatório pra ESTA action" é validado aqui, não no Zod). Fonte única:
 * antes vivia copiado verbatim em 5 tool files.
 */
export function need<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Faltando arg "${name}" pra essa action.`);
  }
  return value;
}

/**
 * Rejeita alvos locais óbvios (localhost / IP privado / link-local literal).
 * NÃO é uma allowlist de host: só barra o que nunca é referência legítima.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return true; // IPv6 loopback/ULA
  if (host === "0.0.0.0") return true;
  if (/^127\./.test(host)) return true; // loopback
  if (/^10\./.test(host)) return true; // privado
  if (/^192\.168\./.test(host)) return true; // privado
  if (/^169\.254\./.test(host)) return true; // link-local
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true; // privado 172.16-31
  return false;
}

/**
 * Zod pra um campo de URL de referência pública (imagem/vídeo que o backend vai
 * buscar). Valida que é http(s) parseável e não aponta pra localhost/IP privado.
 *
 * É defesa-em-profundidade NO CLIENTE: rejeita lixo cedo com erro claro. A
 * allowlist de HOST autoritativa (Bunny/Convex/Wikimedia/YouTube...) vive
 * server-side no Convex e NÃO é duplicada aqui de propósito — se fosse, liberar
 * um CDN novo no backend faria toda versão já publicada do pacote passar a
 * recusar URL válida até republicar e reiniciar cada client (bug de skew). Aqui
 * só cai o que é universalmente inválido.
 */
export function httpUrl() {
  return z
    .string()
    .url()
    .refine((u) => {
      try {
        const { protocol, hostname } = new URL(u);
        if (protocol !== "http:" && protocol !== "https:") return false;
        return !isPrivateHost(hostname);
      } catch {
        return false;
      }
    }, "URL deve ser http(s) pública (sem localhost nem IP privado).");
}
