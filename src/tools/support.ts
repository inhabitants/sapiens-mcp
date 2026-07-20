import { z } from "zod";
import {
  convexQuery,
  convexMutation,
  getSessionToken,
} from "../convexClient.js";

/**
 * sapiens_support — abrir e tocar chamados de suporte do PRÓPRIO user pelo
 * Claude (qualquer logado; identidade SEMPRE do sessionToken). Escopo travado
 * no dono: você só vê e mexe nos SEUS tickets, nunca nos de outra pessoa.
 *
 * Sub-actions:
 *   - create: abre um chamado novo (subject obrigatório; message = primeira
 *             mensagem opcional; whatsapp opcional pra contato). Devolve ticketId.
 *   - list:   seus chamados (subject, status open/closed, escalado, data).
 *   - get:    um chamado seu (ticketId) com o histórico de mensagens.
 *   - reply:  responde num chamado seu (entra como mensagem do user; se estava
 *             fechado, reabre).
 *
 * Fechar/escalar/deletar ficam no lado do suporte (fora do MCP).
 */

export const supportSchema = z.object({
  action: z.enum(["create", "list", "get", "reply"]),
  subject: z
    .string()
    .optional()
    .describe("Pra create: o assunto do chamado."),
  message: z
    .string()
    .optional()
    .describe("Pra create: a primeira mensagem do chamado (opcional)."),
  whatsapp: z
    .string()
    .optional()
    .describe("Pra create: whatsapp de contato (opcional)."),
  ticketId: z
    .string()
    .optional()
    .describe("Pra get/reply: o id do chamado (vem de action=list)."),
  content: z
    .string()
    .optional()
    .describe("Pra reply: o texto da sua resposta."),
});

export type SupportArgs = z.infer<typeof supportSchema>;

export async function support(args: SupportArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "create") {
    if (!args.subject?.trim()) {
      throw new Error("action=create exige subject (o assunto do chamado).");
    }
    const res: any = await convexMutation("support:mcpCreateTicket", {
      sessionToken,
      subject: args.subject.trim(),
      ...(args.message?.trim() ? { message: args.message.trim() } : {}),
      ...(args.whatsapp?.trim() ? { whatsapp: args.whatsapp.trim() } : {}),
    });
    return {
      ...res,
      note: "Chamado aberto. Pra acompanhar: action=get ticketId=<ticketId>. Pra responder: action=reply.",
    };
  }

  if (args.action === "list") {
    const tickets: any = await convexQuery("support:mcpListMine", { sessionToken });
    return {
      count: Array.isArray(tickets) ? tickets.length : 0,
      tickets,
      note: "Seus chamados. Pra abrir um: action=get ticketId=<_id>.",
    };
  }

  if (args.action === "get") {
    if (!args.ticketId?.trim()) {
      throw new Error("action=get exige ticketId (de action=list).");
    }
    return await convexQuery("support:mcpGetMine", {
      sessionToken,
      ticketId: args.ticketId.trim(),
    });
  }

  if (args.action === "reply") {
    if (!args.ticketId?.trim()) {
      throw new Error("action=reply exige ticketId (de action=list).");
    }
    if (!args.content?.trim()) {
      throw new Error("action=reply exige content (o texto da resposta).");
    }
    const res: any = await convexMutation("support:mcpReply", {
      sessionToken,
      ticketId: args.ticketId.trim(),
      content: args.content.trim(),
    });
    return {
      ...res,
      note: res.reopened
        ? "Resposta enviada. O chamado estava fechado e foi reaberto."
        : "Resposta enviada no chamado.",
    };
  }
}
