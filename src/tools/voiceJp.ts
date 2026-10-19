import { z } from "zod";
import { convexMutation, convexQuery, getSessionToken } from "../convexClient.js";

/**
 * Voz japonesa (TTS Irodori), motor LOCAL da casa. ADMIN-only.
 *
 * O QUE É: um motor de fala japonesa que roda numa GPU nossa, não numa API
 * paga. Custa ZERO Sinapse. Em compensação ele não é instantâneo por natureza:
 * o job entra numa fila e um worker do outro lado puxa. Com o worker ligado,
 * um take de 6 segundos fica pronto em 2 a 4 segundos.
 *
 * O CORTE: só japonês. Texto em qualquer outra língua sai como leitura errada,
 * não como sotaque. Não tente "português com sotaque japonês" aqui.
 *
 * O QUE MAIS ERRA (medido, não achado): caption longo e descritivo pedindo
 * "homem de voz grave" empurra a voz pro AGUDO neste fine-tune. Registro grave
 * é texto + caption CURTO ou nenhum, e a voz vem da SEED. Chame action=models
 * antes de escrever um caption caprichado.
 *
 * Fluxo típico:
 *   1. action=models   -> motores, limites e as duas notas que evitam take ruim
 *   2. action=queue    -> o worker está vivo? (não enfileire dez takes no vazio)
 *   3. action=speak    -> gera (espera o áudio por padrão)
 *   4. action=list     -> o histórico, com a seed usada em cada take
 */
export const voiceJpSchema = z.object({
  action: z
    .enum(["speak", "status", "list", "queue", "models"])
    .describe(
      "speak = enfileira e espera o áudio; status = 1 job por id; list = histórico; queue = saúde da fila (worker vivo?); models = catálogo + limites + as notas de uso.",
    ),
  text: z
    .string()
    .optional()
    .describe(
      "O que vai ser falado, EM JAPONÊS (obrigatório em speak). Outra língua sai como leitura errada. Teto de 300 caracteres: texto maior vira vários takes.",
    ),
  caption: z
    .string()
    .optional()
    .describe(
      "Estilo da fala, em japonês. CURTO ganha: caption longo e descritivo empurra a voz pro agudo neste motor. Pra registro grave (seinen), prefira omitir e variar a seed.",
    ),
  modelId: z
    .string()
    .optional()
    .describe("id do catálogo (action=models). Default: irodori-4-1-anime."),
  seed: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Trava a identidade da voz. Sem seed o worker sorteia e devolve a usada em usedSeed: é assim que se repete a MESMA voz num próximo take.",
    ),
  numSteps: z
    .number()
    .int()
    .optional()
    .describe("Passos de amostragem, 8 a 120. Default 40; abaixo disso a fala perde definição e o ganho de tempo é pequeno."),
  cfgScaleText: z.number().optional().describe("Aderência ao texto. Default 3."),
  cfgScaleCaption: z
    .number()
    .optional()
    .describe(
      "Força do caption. Default 4. Subir NÃO conserta caption que desobedece (medimos 4 -> 7 sem mudança): reescreva o caption menor.",
    ),
  cfgScaleSpeaker: z.number().optional().describe("Aderência à voz. Default 5."),
  wait: z
    .boolean()
    .optional()
    .describe(
      "Default true: espera o worker terminar e já devolve a audioUrl. false devolve só o jobId, pra você seguir e checar depois com action=status.",
    ),
  waitSeconds: z
    .number()
    .int()
    .positive()
    .max(180)
    .optional()
    .describe("Quanto esperar em speak. Default 60. Estourar não perde o job: ele continua na fila."),
  jobId: z.string().optional().describe("obrigatório em action=status."),
  status: z
    .enum(["pending", "claimed", "completed", "error"])
    .optional()
    .describe("Filtra o histórico (action=list)."),
  limit: z.number().int().positive().max(100).optional().describe("Default 20, max 100 (action=list)."),
});

export type VoiceJpArgs = z.infer<typeof voiceJpSchema>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function voiceJp(args: VoiceJpArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "models") {
    return await convexQuery("voiceJp:mcpModels", { sessionToken });
  }

  if (args.action === "queue") {
    const health = await convexQuery("voiceJp:mcpQueueHealth", { sessionToken });
    // Traduz o número em recado: "worker parado" é o que o agente precisa
    // saber antes de enfileirar, e ninguém quer ler milissegundo cru.
    const paradoHa = health?.ultimoTakeCompletoMs;
    const workerProvavelmenteVivo =
      typeof paradoHa === "number" ? paradoHa < 15 * 60 * 1000 : health?.pendentes === 0;
    return {
      ...health,
      leitura: workerProvavelmenteVivo
        ? "Worker parece vivo."
        : "Nenhum take fechou nos últimos 15 min. O worker pode estar desligado: confirme antes de enfileirar em série.",
    };
  }

  if (args.action === "status") {
    if (!args.jobId) throw new Error("action=status exige jobId.");
    return await convexQuery("voiceJp:mcpStatus", { sessionToken, jobId: args.jobId });
  }

  if (args.action === "list") {
    return await convexQuery("voiceJp:mcpList", {
      sessionToken,
      limit: args.limit,
      status: args.status,
    });
  }

  // action=speak
  if (!args.text) throw new Error("action=speak exige text (em japonês).");

  const enqueued = await convexMutation("voiceJp:mcpEnqueue", {
    sessionToken,
    text: args.text,
    caption: args.caption,
    modelId: args.modelId,
    seed: args.seed,
    numSteps: args.numSteps,
    cfgScaleText: args.cfgScaleText,
    cfgScaleCaption: args.cfgScaleCaption,
    cfgScaleSpeaker: args.cfgScaleSpeaker,
  });

  if (args.wait === false) {
    return {
      ...enqueued,
      dica: "Job na fila. Chame action=status com este jobId pra pegar a audioUrl.",
    };
  }

  const teto = (args.waitSeconds ?? 60) * 1000;
  const inicio = Date.now();
  let espera = 1000;
  while (Date.now() - inicio < teto) {
    await sleep(espera);
    // Sobe o intervalo devagar: o take típico fecha em 2 a 4s, mas fila com
    // vários takes na frente não merece uma rajada de polling.
    espera = Math.min(5000, Math.round(espera * 1.4));
    const job = await convexQuery("voiceJp:mcpStatus", { sessionToken, jobId: enqueued.jobId });
    if (job?.status === "completed") {
      return { ...job, esperouSegundos: Math.round((Date.now() - inicio) / 1000) };
    }
    if (job?.status === "error") {
      throw new Error(`Geração falhou: ${job.errorMessage || "sem detalhe"}`);
    }
  }

  return {
    jobId: enqueued.jobId,
    status: "pending",
    aviso: `Passou de ${args.waitSeconds ?? 60}s sem fechar. O job NÃO foi perdido, segue na fila. Cheque action=status, e action=queue pra ver se o worker está de pé.`,
  };
}
