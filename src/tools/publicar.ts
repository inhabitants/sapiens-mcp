import { z } from "zod";
import { convexAction, getSessionToken } from "../convexClient.js";
import { need } from "../schema.js";

/**
 * sapiens_publicar: a peça do MEMBRO saindo pelas redes DELE.
 *
 * O mesmo Distribution da tela (/dashboard/distribution: a fila à esquerda, a
 * ficha da peça à direita), lido por quem não tem tela: a fila peça × rede, as
 * redes com o limite de texto e a régua de cada praça, onde a peça já está, pra
 * onde vale mandar, a legenda de cada rede e o envio. Irmã da
 * sapiens_distribution, que é a fila da CASA (admin); aqui é a conta da pessoa,
 * pelo Distribution dela (assinatura ou convite).
 *
 * Sub-actions:
 *   - fila:      a fila da pessoa: cada peça com o estado em cada rede
 *                (rascunho, agendado, enviado, publicado, falhou, descartado).
 *   - painel:    as redes (conectada ou não, @, limite, régua). Com `handle`,
 *                a peça: onde já está, por rede, e a sugestão de onde mandar.
 *                Quem comprou CONTA EXTRA vê `contasExtras`: cada conta com os
 *                destinos ligados nela ("tiktok@2" é o TikTok da conta 2).
 *   - rascunho:  guarda a legenda de UMA rede pra peça (vazia apaga).
 *   - publicar:  manda agora ou agenda. Legenda em blocos: text (corpo), cta,
 *                hashtags. Cada rede leva o que cabe no limite dela.
 *   - lista:     o que já saiu (os envios recentes, com o estado por rede).
 *   - conferir:  pergunta ao fornecedor o que cada rede fez com um envio.
 *   - cancelar:  tira a hora de um agendado; a peça volta pra fila daquela rede.
 *   - teia:      as regras da Teia da pessoa ("quando sai no Instagram, entra na
 *                fila do Threads"). Com de + para + mudanca, liga, pausa ou
 *                apaga uma. A filha nasce na fila e espera o clique.
 *
 * Postar de novo não é action à parte: rascunho ou publicar numa rede onde a
 * peça já saiu abre um cartão novo, e o que saiu fica no rastro.
 *
 * Identidade SEMPRE pelo sessionToken. Sem custo em Sinapses: o teto é o do
 * plano do Distribution (publicações por ciclo), e o servidor confere tudo de
 * novo (dono da peça, rede, limite, tipo de mídia).
 */

export const publicarSchema = z.object({
  action: z.enum(["fila", "painel", "rascunho", "publicar", "lista", "conferir", "cancelar", "teia"]),
  handle: z
    .string()
    .optional()
    .describe("A peça (img_..., vid_..., car_... pro carrossel inteiro). Obrigatório em rascunho e publicar; em painel traz a peça junto."),
  rede: z
    .string()
    .optional()
    .describe("rascunho: a rede (id do painel: instagram, tiktok, threads...). Numa conta extra, o destino com a conta: tiktok@2."),
  legenda: z.string().optional().describe("rascunho: a legenda daquela rede. Vazia apaga o rascunho."),
  redes: z
    .array(z.string())
    .optional()
    .describe(
      "publicar: as redes (ids do painel), só as conectadas. Conta extra vai com a conta: tiktok@2 é o TikTok da conta 2 (painel, contasExtras). Um envio sai por UMA conta: pra publicar na conta 1 e na 2, chame publicar duas vezes.",
    ),
  text: z.string().optional().describe("publicar: o CORPO da legenda. Ausente usa o título da peça."),
  cta: z.string().optional().describe("publicar: a chamada, em bloco à parte. Sai antes do corpo quando não cabe."),
  hashtags: z
    .array(z.string())
    .optional()
    .describe("publicar: as hashtags, sem #. São as primeiras a sair onde o limite aperta."),
  legendas: z
    .record(z.string(), z.string())
    .optional()
    .describe("publicar: legenda própria por rede ({threads: '...'}, ou {'threads@2': '...'} na conta extra), passa por cima dos blocos naquela rede."),
  agendarPara: z
    .string()
    .optional()
    .describe("publicar: data e hora ISO 8601 COM fuso (2026-10-08T19:00:00-03:00). Ausente = agora. Mínimo 5 min à frente."),
  postId: z.string().optional().describe("conferir/cancelar: o id do envio, vindo da lista."),
  de: z.string().optional().describe("teia: a rede de origem da regra (id do painel), onde a peça sai primeiro."),
  para: z.string().optional().describe("teia: a rede de destino, em cuja fila a peça entra."),
  mudanca: z
    .enum(["ligar", "pausar", "apagar"])
    .optional()
    .describe("teia: ligar (cria ou despausa), pausar ou apagar a regra de -> para. Ausente = só lê as regras."),
});

export type PublicarArgs = z.infer<typeof publicarSchema>;

export async function publicar(args: PublicarArgs): Promise<any> {
  const sessionToken = getSessionToken();

  switch (args.action) {
    case "fila":
      return await convexAction("uploadPost:mcpFila", { sessionToken });

    case "painel":
      return await convexAction("uploadPost:mcpPainel", {
        sessionToken,
        ...(args.handle ? { handle: args.handle } : {}),
      });

    case "rascunho":
      return await convexAction("uploadPost:salvarRascunho", {
        sessionToken,
        handle: need(args.handle, "handle"),
        rede: need(args.rede, "rede"),
        legenda: args.legenda ?? "",
      });

    case "publicar": {
      const redes = args.redes ?? [];
      if (redes.length === 0) throw new Error("Falta `redes`: em quais redes a peça sai (ids do painel).");
      let scheduledAt: number | undefined;
      if (args.agendarPara) {
        scheduledAt = Date.parse(args.agendarPara);
        if (!Number.isFinite(scheduledAt)) {
          throw new Error("`agendarPara` não é uma data ISO válida. Ex: 2026-10-08T19:00:00-03:00.");
        }
      }
      return await convexAction("uploadPost:publishOwn", {
        sessionToken,
        handle: need(args.handle, "handle"),
        networks: redes,
        ...(args.text ? { text: args.text } : {}),
        ...(args.cta ? { cta: args.cta } : {}),
        ...(args.hashtags?.length ? { hashtags: args.hashtags } : {}),
        ...(args.legendas && Object.keys(args.legendas).length ? { captions: args.legendas } : {}),
        ...(scheduledAt !== undefined ? { scheduledAt } : {}),
      });
    }

    case "lista":
      return await convexAction("uploadPost:mcpMinhasPublicacoes", { sessionToken });

    case "conferir":
      return await convexAction("uploadPost:conferirPublicacao", {
        sessionToken,
        postId: need(args.postId, "postId"),
      });

    case "cancelar":
      return await convexAction("uploadPost:cancelarAgendado", {
        sessionToken,
        postId: need(args.postId, "postId"),
      });

    case "teia":
      return await convexAction("uploadPost:mcpTeia", {
        sessionToken,
        ...(args.mudanca
          ? { acao: args.mudanca, de: need(args.de, "de"), para: need(args.para, "para") }
          : {}),
      });
  }
}
