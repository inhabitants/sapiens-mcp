import { z } from "zod";
import {
  convexQuery,
  convexMutation,
  getSessionToken,
} from "../convexClient.js";

/**
 * sapiens_semana: as Atividades da semana do membro pelo Claude.
 *
 * A casa passou a medir PRODUÇÃO: cada peça pronta anda o contador da atividade,
 * e no fecho da semana a LARGURA (quantas atividades diferentes você fez) paga um
 * bônus que cresce a cada atividade nova. (O slug interno segue `labs` por
 * retrocompat; na fala, é Atividade: Lab é o App que ainda não cresceu.) Quem opera a casa pelo connector é justamente quem
 * produz em várias frentes, então a régua precisa existir aqui também.
 *
 * Sub-actions:
 *   - get:    como está a semana (atividades feitas, quanto a Casa Cheia renderia
 *             no fecho, e se sobrou semana anterior pra fechar).
 *   - fechar: fecha as semanas pendentes e credita a Casa Cheia de cada uma.
 *
 * Identidade SEMPRE pelo sessionToken. Sem custo em Sinapses: isto PAGA XP, não
 * cobra. Idempotente no servidor, então chamar duas vezes não credita duas vezes.
 */

export const semanaSchema = z.object({
  action: z.enum(["get", "fechar"]),
});

export type SemanaArgs = z.infer<typeof semanaSchema>;

export async function semana(args: SemanaArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "get") {
    const s: any = await convexQuery("labs:mcpGetMinhaSemana", { sessionToken });
    if (!s) throw new Error("Não consegui ler sua semana. Confira o login.");

    const usados = (s.labs ?? []).filter((l: any) => l.usado);
    const vazios = (s.labs ?? []).filter((l: any) => !l.usado);

    return {
      semana: s.weekKey,
      // A leitura da semana, montada no servidor a partir do rastro (o lab que
      // sumiu, a sequência de pé, a semana em branco). Vem pronta pra ser dita:
      // não é dado bruto pro modelo reescrever.
      leitura: s.leitura ?? null,
      labsUtilizados: usados.map((l: any) => ({
        lab: l.label,
        pecas: l.pieces,
        pago: l.pago,
      })),
      labsAindaVazios: vazios.map((l: any) => l.label),
      xpDeOficioNaSemana: s.oficioDaSemana,
      casaCheiaSeFecharAgora: s.casaCheiaPrevista,
      // O EMPURRÃO: quanto vale abrir mais um lab, e quais valem a pena agora.
      // A ordem das sugestões é por atrito (o passo possível), não por XP.
      ganhoDeAbrirMaisUmLab: s.ganhoLabNovo ?? 0,
      sugestoes: (s.sugestoes ?? []).map((x: any) => ({
        lab: x.label,
        xpDaPrimeiraPeca: x.xpPrimeira,
        queimaSinapse: x.pago,
      })),
      // A continuidade: quantas semanas seguidas de pé, o recorde, e as
      // anteriores com o que cada uma rendeu.
      sequencia: s.sequencia ?? null,
      semanasAnteriores: (s.semanas ?? []).map((w: any) => ({
        semana: w.weekKey,
        labs: w.labs,
        pecas: w.pieces,
        xp: w.xp,
        casaCheia: w.casaCheia,
        fechada: w.fechada,
      })),
      semanasPendentes: s.semanasPendentes ?? [],
      note:
        (s.semanasPendentes?.length ?? 0) > 0
          ? "Tem semana fechada esperando: action=fechar credita a Casa Cheia dela."
          : "A Casa Cheia da semana corrente é creditada quando ela virar e você fechar.",
      comoFunciona:
        "Cada atividade paga por peça pronta em degraus (1a, 3a, 7a, 15a, 30a da semana). No fecho, a largura paga à parte: 2 atividades valem 20 XP, 5 valem 200, 8 valem 560. Atividades diferentes rendem mais que repetir a mesma. (As chaves labsUtilizados/labsAindaVazios seguem com o nome antigo por retrocompat.)",
    };
  }

  if (args.action === "fechar") {
    const r: any = await convexMutation("labs:mcpFecharMinhaSemana", {
      sessionToken,
    });
    if (!r?.fechadas) {
      return {
        fechadas: 0,
        xp: 0,
        note: "Não tinha semana pendente. A semana corrente só fecha depois que ela virar.",
      };
    }
    return {
      fechadas: r.fechadas,
      xpCreditado: r.xp,
      note: `Casa cheia creditada: +${r.xp} XP em ${r.fechadas} semana(s). O servidor fecha até 12 por chamada, então repita se ainda sobrar.`,
    };
  }

  throw new Error("action inválida. Use get ou fechar.");
}
