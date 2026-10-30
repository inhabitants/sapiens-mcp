import { z } from "zod";
import { convexAction, getSessionToken } from "../convexClient.js";

/**
 * Agentes da casa: o membro roda um agente autoral e recebe só a peça. O
 * método (o manual do agente) mora no servidor e não viaja neste pacote nem na
 * resposta; o cliente manda o nome do agente e o conceito.
 *
 *   - list: os agentes abertos pra membro e o preço da rodada. Sem login, sem
 *           custo.
 *   - run:  roda o agente no conceito. Cobra a rodada em Sinapses; se o modelo
 *           falhar, as Sinapses voltam.
 */

export const agenteSchema = z.object({
  action: z.enum(["list", "run"]).describe("list = os agentes abertos e o preço; run = roda um agente no conceito."),
  agente: z
    .string()
    .optional()
    .describe("Nome curto do agente, como sai em action=list (ex: 'maquinista'). Obrigatório em run."),
  conceito: z
    .string()
    .optional()
    .describe(
      "O conceito da peça, até 4.000 caracteres: tema, clima e som, ou a letra colada pra apertar. Obrigatório em run.",
    ),
});

export type AgenteArgs = z.infer<typeof agenteSchema>;

export async function agente(args: AgenteArgs): Promise<any> {
  if (args.action === "list") {
    return await convexAction("labAgentes:mcpList", {});
  }
  if (!args.agente?.trim() || !args.conceito?.trim()) {
    throw new Error("action=run exige agente + conceito. Os nomes saem em action=list.");
  }
  return await convexAction("labAgentes:mcpRun", {
    sessionToken: getSessionToken(),
    agente: args.agente,
    conceito: args.conceito,
  });
}
