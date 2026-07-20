import { z } from "zod";
import {
  convexQuery,
  convexMutation,
  getSessionToken,
} from "../convexClient.js";

/**
 * sapiens_trilhas — Trilhas (cursos) e Desafios (missões) da Sapiens pelo
 * Claude. Identidade SEMPRE pelo sessionToken; o que credita Sinapses passa
 * por revisão do dono, nunca auto-crédito por aqui. ("Ritos de Fogo" é o nome
 * antigo dos Desafios; saiu no saneamento de naming de jul/2026.)
 *
 * Sub-actions:
 *   - list:            suas trilhas (título + contagem de módulos/aulas) +
 *                      quantas aulas você já fechou.
 *   - get:             1 trilha por slug, com módulos e aulas.
 *   - list_challenges: Desafios ativos + seu status em cada um
 *                      (pendente/completo/rejeitado/não-iniciado) + recompensa.
 *   - claim_mission:   submete a prova de um Desafio (missionId + proofText)
 *                      pra REVISÃO do dono. O crédito sai quando ele aprovar.
 *
 * Fluxo natural: list → get slug=<x> pra detalhar; list_challenges →
 * claim_mission missionId=<id> proofText=<sua prova>.
 */

export const trilhasSchema = z.object({
  action: z.enum(["list", "get", "list_challenges", "claim_mission"]),
  slug: z
    .string()
    .optional()
    .describe("Pra get: slug da trilha (vem do list)."),
  missionId: z
    .string()
    .optional()
    .describe("Pra claim_mission: id do Desafio (vem do list_challenges)."),
  proofText: z
    .string()
    .optional()
    .describe(
      "Pra claim_mission: a prova (link, @handle ou descrição) que o dono vai revisar.",
    ),
});

export type TrilhasArgs = z.infer<typeof trilhasSchema>;

export async function trilhas(args: TrilhasArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "list") {
    const courses: any = await convexQuery("lms:getCourses", {});
    const progress: any = await convexQuery("userProgress:mcpGetMyProgress", {
      sessionToken,
    });
    const trilhasOut = (Array.isArray(courses) ? courses : []).map((c: any) => {
      const modules = Array.isArray(c.modules) ? c.modules : [];
      const lessonCount = modules.reduce(
        (n: number, m: any) => n + (Array.isArray(m.lessons) ? m.lessons.length : 0),
        0,
      );
      return {
        slug: c.slug,
        title: c.title,
        moduleCount: modules.length,
        lessonCount,
      };
    });
    return {
      trilhas: trilhasOut,
      progress: {
        completedLessons: progress?.completedCount ?? 0,
      },
      note: "Pra detalhar uma trilha: action=get slug=<slug>.",
    };
  }

  if (args.action === "get") {
    if (!args.slug?.trim()) {
      throw new Error("action=get exige slug (pega um no action=list).");
    }
    const course: any = await convexQuery("lms:getCourseBySlug", {
      slug: args.slug.trim(),
    });
    if (!course) {
      throw new Error(`Trilha não encontrada: ${args.slug}`);
    }
    return course;
  }

  if (args.action === "list_challenges") {
    const missions: any = await convexQuery("missions:listActive", {});
    const mine: any = await convexQuery("userMissions:mcpGetMySubmissions", {
      sessionToken,
    });
    const byMission = new Map<string, any>();
    (Array.isArray(mine) ? mine : []).forEach((m: any) =>
      byMission.set(String(m.missionId), m),
    );
    const challenges = (Array.isArray(missions) ? missions : []).map((m: any) => {
      const sub = byMission.get(String(m._id));
      return {
        missionId: m._id,
        title: m.title,
        description: m.description,
        rewardSinapses: m.rewardSinapses,
        type: m.type,
        verificationType: m.verificationType,
        linkToClick: m.linkToClick ?? null,
        myStatus: sub?.status ?? "not_started",
        reviewNotes: sub?.reviewNotes ?? null,
      };
    });
    return {
      challenges,
      note: "Pra reivindicar: action=claim_mission missionId=<id> proofText=<sua prova>. Vai pra revisão do dono; o crédito sai quando ele aprovar.",
    };
  }

  if (args.action === "claim_mission") {
    if (!args.missionId?.trim()) {
      throw new Error("action=claim_mission exige missionId (vem do list_challenges).");
    }
    if (!args.proofText?.trim()) {
      throw new Error(
        "action=claim_mission exige proofText (o link/@/descrição que prova o feito).",
      );
    }
    const res: any = await convexMutation("userMissions:mcpSubmitProof", {
      sessionToken,
      missionId: args.missionId.trim(),
      proofText: args.proofText.trim(),
    });
    return {
      ...res,
      note: "Prova enviada. Status: em revisão. O dono aprova e as Sinapses caem na sua conta.",
    };
  }

  throw new Error(`action desconhecida: ${(args as any).action}`);
}
