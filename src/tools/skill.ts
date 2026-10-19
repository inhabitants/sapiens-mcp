import { z } from "zod";
import { getSkillMd, listSkills } from "../skills.js";

/**
 * sapiens_skill: as skills da casa servidas pelo próprio connector.
 *
 * É a tool mais barata do catálogo e a única que NÃO fala com o backend: o
 * conteúdo é estático, mora no pacote, não exige login, não custa Sinapse e
 * não pode falhar por rede. Existe pra dois motivos:
 *
 *   1. O saber de fluxo saiu do SAPIENS_INSTRUCTIONS (que viaja em TODO
 *      handshake) e virou conteúdo sob demanda. Handshake magro, saber fundo.
 *   2. Nem todo cliente MCP lê `resources`. Quem lê pega por
 *      skill://sapiens/<name>/SKILL.md; quem não lê, pega por aqui. Mesmo
 *      conteúdo, duas portas.
 */

export const skillSchema = z.object({
  action: z
    .enum(["list", "get"])
    .default("list")
    .describe(
      "'list' devolve o índice (slug + quando usar) das skills da casa. 'get' devolve o SKILL.md inteiro de uma.",
    ),
  name: z
    .string()
    .optional()
    .describe(
      "Slug da skill no action=get. Ex: 'musica', 'video', 'voz-da-casa'. Rode action=list se não souber.",
    ),
});

export type SkillArgs = z.infer<typeof skillSchema>;

export async function skill(args: SkillArgs): Promise<any> {
  const action = args.action ?? "list";

  if (action === "list") {
    const skills = listSkills();
    return {
      count: skills.length,
      skills,
      note: "Chame action=get name=<slug> pra ler a skill inteira antes de operar o fluxo.",
    };
  }

  const name = args.name?.trim();
  if (!name) {
    return {
      error: "action=get exige 'name'. Rode action=list pra ver os slugs.",
      available: listSkills().map((s) => s.name),
    };
  }

  const md = getSkillMd(name);
  if (!md) {
    return {
      error: `Skill '${name}' não existe.`,
      available: listSkills().map((s) => s.name),
    };
  }

  return { name, content: md };
}
