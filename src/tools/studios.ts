import { z } from "zod";
import { convexAction, convexMutation, getSessionToken } from "../convexClient.js";

/**
 * Duas coisas com o mesmo nome, e o `action` separa as duas:
 *
 * 1. O CATÁLOGO dos estúdios/experimentos da casa (`list`/`get`): info estática
 *    com URL do dashboard, status e tags, pro Claude rotear o user pro lugar
 *    certo quando ele pede coisa que o plugin não cobre.
 * 2. O STUDIO DO MEMBRO (`mine`/`create`): a página de portfólio da empresa
 *    dele. Fundar é aqui; vestir a página (capa, logo, sobre, seções) e montar
 *    o time é na própria página, no modo edição.
 *
 * A Emancipação (o antigo "Nível 3", blueprint pra construir a casa própria na
 * infra do membro) saiu em ago/2026 junto com os níveis: o studio virou perfil
 * de empresa, não uma jornada. As queries `studioBlueprints:mcp*` seguem no
 * backend só como aviso pra pacote publicado que ainda chama.
 */

export const studiosSchema = z.object({
  action: z
    .enum(["list", "get", "publishable_url", "mine", "create"])
    .describe(
      "mine = o SEU studio (a página de portfólio da sua casa): nome, endereço público, marca, operador e tamanho do time. " +
        "create = FUNDA um studio novo na conta do user (exige 'name'). Nasce NO AR, com endereço público e ele como fundador (studio não tem rascunho); vestir a página é na própria página. Teto de 4 por pessoa. " +
        "list/get = catálogo de estúdios da casa. publishable_url = URL de artigo.",
    ),
  studio: z
    .string()
    .optional()
    .describe(
      "Pra action=get: slug do estúdio (ex 'helen-voice', 'musicator', 'persona-sapiens', 'sapiens-video').",
    ),
  name: z
    .string()
    .optional()
    .describe(
      "Pra action=create: o nome da casa (obrigatório). O endereço público sai daí, em kebab-case. Pergunte ao user, não invente.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      "Pra action=create: uma linha do que a casa faz (até 200 chars). Opcional, mas é o que aparece embaixo do nome na página.",
    ),
  brandSlug: z
    .string()
    .optional()
    .describe(
      "Pra action=create: marca da casa (slug de sapiens_brand). Opcional. Só passa marca que é do user.",
    ),
  publishableId: z
    .string()
    .optional()
    .describe(
      "Pra action=publishable_url: ID do publishable. Retorna URL canônica /articles/<slug>.",
    ),
  slug: z
    .string()
    .optional()
    .describe("Alternativa a publishableId — passe o slug direto."),
});

export type StudiosArgs = z.infer<typeof studiosSchema>;

const APP = "https://sapiensinteticos.com";

const STUDIOS = {
  "helen-voice": {
    name: "Helen Voice (TTS)",
    description:
      "Text-to-speech via ElevenLabs ou Google TTS (Gemini), sempre em Sinapses: a casa não recebe chave de provedor. Voice cloning a partir de samples (UI-only). v1.4: speak via MCP.",
    url: `${APP}/dashboard/personagens`,
    status: "stable",
    tags: ["audio", "tts", "elevenlabs", "google", "voice"],
    convex: "helenVoiceActions",
    mcpReady: true,
    mcpNote:
      "Coberto via sapiens_helen (speak + list_presets). Voice cloning de samples continua UI-driven.",
  },
  musicator: {
    name: "Musicator",
    description:
      "Gerador de música com letra + estilo + variantes. LLM escreve letra (PT), synth musical (Lyria/ACE/Suno) renderiza. v2.0: loop completo via MCP.",
    url: `${APP}/experimentos/musicator`,
    status: "stable",
    tags: ["audio", "music", "lyrics", "ace", "suno", "lyria"],
    convex: "musicatorActions",
    mcpReady: true,
    mcpNote:
      "Loop completo via sapiens_musicator: create (brief+track) → lyrics(trackId) → render → get (poll status). Não precisa mais da UI. Tudo escopado por dono.",
  },
  "persona-sapiens": {
    name: "Persona Sapiens",
    description:
      "Teste de personalidade pra AUTOCONHECIMENTO (não é gerador de imagem): quiz que cruza MBTI com humores antigos, elementos e estilos. 48 perguntas Likert (~10 min), resultado com persona/animal cultural/sombra/espelho, salvo no perfil do user. Secundário: arte ilustrada dos 16 arquétipos MBTI (full-bleed, Sapiens style).",
    url: `${APP}/experimentos/persona-sapiens`,
    status: "stable",
    tags: ["persona", "mbti", "quiz", "autoconhecimento", "perfil", "personalidade", "teste"],
    convex: "personalityProfiles",
    mcpReady: true,
    mcpNote:
      "Coberto via sapiens_persona. PRIMÁRIO (de graça, qualquer logado): get_quiz + submit_quiz + my_profile — aplica o teste conversando e ALIMENTA o personalityProfile do user. SECUNDÁRIO: generate + list_codes (arte dos arquétipos, 450 Sinapses).",
  },
  "sapiens-video": {
    name: "Sapiens Video (longer-form)",
    description: "Vídeo longer-form com prompt livre. v1.5: generate via MCP.",
    url: `${APP}/imgen-sapiens-video`,
    status: "beta",
    tags: ["video", "longform", "voiceover", "veo"],
    convex: "sapiensVideoActions",
    mcpReady: true,
    mcpNote:
      "Coberto via sapiens_video (generate). Aspect configurável, references opcionais (start/end frames).",
  },
  "text-post-builder": {
    name: "Text Post Builder",
    description:
      "Gerador de post de texto puro pra rede social (Instagram, LinkedIn, Twitter). Inclui geração de imagem opcional acoplada.",
    url: `${APP}/experimentos/text-post-builder`,
    status: "stable",
    tags: ["text", "social", "post", "instagram", "linkedin"],
    convex: "textPostGenerator",
    mcpReady: true,
    mcpNote:
      "Parcialmente coberto via sapiens_pipeline format=post_social (texto Claude-side) + sapiens_image.",
  },
  // comic-builder (Tirinhas) saiu do roster em ago/2026: peça aposentada. As
  // tirinhas publicadas seguem de pé (/tirinha/<id>, cards na Comunidade).
  "carrosel-editorial": {
    name: "Carrossel Editorial",
    description:
      "Carrossel do Instagram com layouts travados: modelos Feed, Reflexão e Case (9 slides) ou editorial livre, folha 4:5 ou 9:16, assinado com a marca de quem faz. O arquivo sai do navegador, no editor.",
    url: `${APP}/experimentos/carrosel-editorial`,
    status: "stable",
    tags: ["carrossel", "instagram", "editorial"],
    convex: "carouselStandalone",
    mcpReady: true,
    mcpNote:
      "Coberto via sapiens_carrossel (gerar, escrever os slides, pôr foto da galeria, capa IA), pra qualquer conta. Baixar é no editor.",
  },
  comunidade: {
    name: "Comunidade Sapiens",
    description:
      "Chat compartilhado entre assinantes/alumni. Posts com voz Sapiens.",
    // /comunidade (sem /dashboard) hoje é 308 pro Acervo; o chat vive aqui.
    url: `${APP}/dashboard/comunidade`,
    status: "stable",
    tags: ["chat", "comunidade"],
    convex: "communityChat",
    mcpReady: true,
    mcpNote: "Coberto via sapiens_community.",
  },
  repertorio: {
    name: "Repertório",
    description:
      "Catálogo pessoal de filme/série/anime/jogo/livro/música. Importa via OMDb/IGDB/AniList/Google Books/iTunes. Pode virar pop-articles (lente cultural).",
    url: `${APP}/u/<username>/repertorio`,
    status: "stable",
    tags: ["acervo", "filme", "anime", "jogo", "pop"],
    convex: "repertorio",
    mcpReady: true,
    mcpNote: "Coberto via sapiens_repertorio (list/search/get + mutations v1.1).",
  },
} as const;

export async function studios(args: StudiosArgs): Promise<any> {
  // action=mine: o studio PRIMÁRIO do user logado (a página de portfólio da casa
  // dele), resumo non-PII. Os campos `level`/`levelLabel`/`tools`/`imageVibe`/
  // `studioMcpRuns` vêm vazios: os níveis e as ferramentas à la carte morreram
  // quando o studio virou página, e a geração ancorada (`useStudio`) morreu com
  // ela; só continuam no retorno porque pacotes já publicados os imprimem.
  if (args.action === "mine") {
    const sessionToken = getSessionToken();
    const studio = await convexAction("desktopMcp:studioMine", { sessionToken });
    if (!studio) {
      return {
        studio: null,
        note: "Você ainda não fundou um studio. Funde o seu em sapiensinteticos.com/dashboard/studio: ele vira uma página pública com a sua obra e o seu time.",
      };
    }
    return { studio };
  }

  if (args.action === "list") {
    return {
      count: Object.keys(STUDIOS).length,
      studios: Object.entries(STUDIOS).map(([slug, s]) => ({
        slug,
        ...s,
      })),
      note:
        "Estúdios com mcpReady=true são operáveis direto pelo plugin. mcpReady=false exige UI do dashboard (link no campo url).",
    };
  }

  if (args.action === "get") {
    if (!args.studio) throw new Error("action=get exige 'studio' (slug).");
    const s = (STUDIOS as any)[args.studio];
    if (!s) {
      const known = Object.keys(STUDIOS).join(", ");
      throw new Error(
        `Estúdio '${args.studio}' desconhecido. Disponíveis: ${known}`,
      );
    }
    return { slug: args.studio, ...s };
  }

  if (args.action === "publishable_url") {
    const slug = args.slug;
    const pid = args.publishableId;
    if (!slug && !pid) {
      throw new Error("publishable_url exige 'slug' OU 'publishableId'.");
    }
    // Pra simplicidade v1.3, o caller passa o slug (que ele já tem do retorno
    // do finalize_production). publishableId fica reservado pra v1.4 quando
    // tivermos lookup slug-by-id.
    return {
      url: slug ? `${APP}/articles/${slug}` : null,
      admin: `${APP}/experimentos/content-pipeline`,
      note: slug
        ? "URL pública. Pra ver versões anteriores, use sapiens_pipeline list_versions."
        : "publishableId lookup ainda não suportado v1.3. Passe slug.",
    };
  }

  // action=create: funda a casa. O servidor resolve o dono pelo sessionToken e
  // devolve o endereço público já montado (quem chama não tem tela pra procurar).
  if (args.action === "create") {
    const name = (args.name ?? "").trim();
    if (!name) {
      throw new Error(
        "action=create exige 'name' (o nome da casa). Pergunte ao user antes de inventar.",
      );
    }
    const sessionToken = getSessionToken();
    const res: any = await convexMutation("studios:mcpCreateStudio", {
      sessionToken,
      name,
      description: args.description,
      brandSlug: args.brandSlug,
    });
    return {
      ...res,
      note: "Studio fundado e JÁ NO AR nesse endereço. O user veste a página (capa, logo, sobre, time, obra) em " +
        `${APP}/studios/${res.slug} no modo edição. Convidar gente exige follow mútuo.`,
    };
  }
}
