/**
 * Imagem que a tool entrega ao chat (03/11/2026): a prévia leve da geração
 * (webp de 828 px, uns 100 KB) aparece na conversa como imagem, não como link.
 * A tool põe a imagem nesta chave do retorno; o registry tira ela do JSON e do
 * structuredContent e manda como bloco `image` do MCP, nos dois transportes.
 */

export const IMAGENS_NO_CHAT = "_imagensNoChat";

export type ImagemNoChat = { data: string; mimeType: string };

/** Teto em base64 (~1 MB de imagem): acima disso não vai pro chat, pra não encher o contexto do agente. */
export const IMAGEM_NO_CHAT_MAX_B64 = 1_400_000;

/** A imagem que cabe no chat, ou nada: só webp, png ou jpeg, e abaixo do teto. */
export function imagemQueCabe(base64: unknown, mimeType: unknown): ImagemNoChat[] {
  if (typeof base64 !== "string" || base64.length === 0 || base64.length > IMAGEM_NO_CHAT_MAX_B64) return [];
  if (mimeType !== "image/webp" && mimeType !== "image/png" && mimeType !== "image/jpeg") return [];
  return [{ data: base64, mimeType }];
}

/** Separa as imagens do resto do retorno: o resto vira o JSON de sempre. */
export function separarImagens(result: unknown): { resto: unknown; imagens: ImagemNoChat[] } {
  if (!result || typeof result !== "object" || Array.isArray(result) || !(IMAGENS_NO_CHAT in result)) {
    return { resto: result, imagens: [] };
  }
  const { [IMAGENS_NO_CHAT]: brutas, ...resto } = result as Record<string, unknown>;
  const imagens = Array.isArray(brutas) ? brutas.flatMap((i: any) => imagemQueCabe(i?.data, i?.mimeType)) : [];
  return { resto, imagens };
}
