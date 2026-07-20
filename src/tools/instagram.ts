import { z } from "zod";
import { convexAction, convexMutation, convexQuery, getSessionToken } from "../convexClient.js";
import { need } from "../schema.js";

/**
 * sapiens_instagram — o "ManyChat da casa" via MCP. ADMIN-ONLY (requireMcpAdmin
 * no Convex): opera o auto-DM do Instagram da casa (regras de resposta
 * automática, inbox das conversas, resposta manual pela janela de 24h).
 * Espelha a UI /dashboard/admin/instagram; backend em convex/instagramDm.ts.
 *
 * Sub-actions:
 *   - rules: lista as regras (keyword, variações, escopo por post, disparos)
 *   - rule_upsert: cria/edita regra (ruleId presente = edita)
 *   - rule_delete: apaga regra por ruleId
 *   - inbox: threads recentes com a janela de 24h de cada (canReply)
 *   - thread: mensagens de uma conversa (igUserId do inbox)
 *   - send: responde uma conversa na mão (só com a janela aberta)
 */

export const instagramSchema = z.object({
  action: z.enum(["rules", "rule_upsert", "rule_delete", "inbox", "thread", "send", "posts"]),
  ruleId: z.string().optional().describe("Id da regra (rule_upsert pra editar, rule_delete)."),
  keyword: z
    .string()
    .optional()
    .describe(
      "Keyword principal da regra (substring case-insensitive por padrão). Obrigatória em regra não-fallback (ou use keywords).",
    ),
  keywords: z
    .array(z.string())
    .optional()
    .describe("Sinônimos: a regra casa se QUALQUER um (keyword + keywords) bater. Ex: [site, url]."),
  matchMode: z
    .enum(["contains", "exact", "starts"])
    .optional()
    .describe("Como a keyword casa: contains (substring, default) / exact (palavra inteira) / starts (texto começa com)."),
  trigger: z
    .enum(["dm", "comment", "story", "all"])
    .optional()
    .describe("O que dispara: dm / comment / story (resposta a story) / all (default: DM e comentário)."),
  reply: z.string().optional().describe("Resposta na DM (obrigatória no rule_upsert)."),
  replyVariants: z
    .array(z.string())
    .optional()
    .describe("Variações da resposta; presentes, rodam em round-robin no lugar da reply."),
  commentEcho: z
    .string()
    .optional()
    .describe("Eco público no comentário depois da DM ('te respondi no direct!'). Só p/ comentário."),
  echoVariants: z.array(z.string()).optional().describe("Variações do eco público (round-robin)."),
  mediaId: z
    .string()
    .optional()
    .describe("Escopo por post: id de mídia do Instagram; a regra só casa comentário DESSE post."),
  isFallback: z
    .boolean()
    .optional()
    .describe("Fallback: responde DM sem keyword (1x/24h por pessoa). Nunca dispara em comentário."),
  active: z.boolean().optional().describe("Regra ativa (default true)."),
  priority: z.number().optional().describe("Menor casa primeiro (default 100)."),
  igUserId: z.string().optional().describe("IGSID da contraparte (vem do inbox). Pra thread e send."),
  text: z.string().optional().describe("Texto da resposta manual (send)."),
  limit: z.number().optional().describe("Máx de itens (inbox default 30, thread default 40)."),
});

export type InstagramArgs = z.infer<typeof instagramSchema>;


export async function instagram(args: InstagramArgs): Promise<any> {
  const sessionToken = getSessionToken();

  switch (args.action) {
    case "rules":
      return await convexQuery("instagramDm:mcpListRules", { sessionToken });

    case "rule_upsert": {
      const reply = need(args.reply, "reply");
      return await convexMutation("instagramDm:mcpUpsertRule", {
        sessionToken,
        ruleId: args.ruleId,
        keyword: args.keyword,
        keywords: args.keywords,
        matchMode: args.matchMode,
        trigger: args.trigger,
        reply,
        replyVariants: args.replyVariants,
        commentEcho: args.commentEcho,
        echoVariants: args.echoVariants,
        mediaId: args.mediaId,
        isFallback: args.isFallback,
        active: args.active,
        priority: args.priority,
      });
    }

    case "rule_delete":
      return await convexMutation("instagramDm:mcpRemoveRule", {
        sessionToken,
        ruleId: need(args.ruleId, "ruleId"),
      });

    case "inbox":
      return await convexQuery("instagramDm:mcpListThreads", {
        sessionToken,
        limit: args.limit,
      });

    case "thread":
      return await convexQuery("instagramDm:mcpThreadMessages", {
        sessionToken,
        igUserId: need(args.igUserId, "igUserId"),
        limit: args.limit,
      });

    case "send":
      return await convexAction("instagramDm:mcpSendDm", {
        sessionToken,
        igUserId: need(args.igUserId, "igUserId"),
        text: need(args.text, "text"),
      });

    case "posts":
      return await convexAction("instagramDm:mcpListMedia", {
        sessionToken,
        limit: args.limit,
      });
  }
}
