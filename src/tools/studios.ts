import { z } from "zod";
import { convexAction, convexQuery, getSessionToken } from "../convexClient.js";

/**
 * Catálogo dos estúdios/experimentos Sapiens (v1.3).
 *
 * Versão minimal: retorna info estática sobre os experimentos disponíveis no
 * app. Cada entry tem URL do dashboard, descrição curta, status (estável /
 * beta / experimental), e tags. Útil pro Claude rotear o user pro lugar
 * certo quando ele pede coisa que não está coberta no plugin v1.x.
 *
 * v1.4 vai adicionar wrappers session-token-auth pros estúdios que justificam
 * (Helen Voice TTS, Musicator letras, Sapiens Shorts render, Persona Sapiens).
 * Por hora skills usam Claude-side + dashboard URL.
 */

export const studiosSchema = z.object({
  action: z
    .enum(["list", "get", "publishable_url", "mine", "emancipar", "module"])
    .describe(
      "mine = o SEU studio ('Meu Studio', singular): nível, marca, operador e ferramentas, pra você gerar com useStudio. list/get = catálogo de estúdios da casa. publishable_url = URL de artigo. " +
        "emancipar = INICIA a Emancipação (Nível 3 do Studio): puxa o blueprint-mestre pra VOCÊ (Claude) construir a casa PRÓPRIA do membro, na infra DELE (Vercel + Convex + domínio dele), FORA do Sapiens. Devolve a identidade do studio dele já hidratada + o índice de módulos + o guia da Fundação. " +
        "module = puxa o guia de UM módulo de infra pra continuar a construção (ex: fundacao, sapiens-connect, midia, telegram, email, auth).",
    ),
  studio: z
    .string()
    .optional()
    .describe(
      "Pra action=get: slug do estúdio (ex 'helen-voice', 'musicator', 'persona-sapiens', 'sapiens-shorts').",
    ),
  module: z
    .string()
    .optional()
    .describe(
      "Pra action=module: slug do módulo de infra da emancipação. Prontos (com guia): fundacao, sapiens-connect, midia, telegram, email, auth. Chegando (no índice, sem guia ainda): pagamentos, analytics.",
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
      "Text-to-speech via ElevenLabs ou Google TTS (Gemini). BYOK suportado. Voice cloning a partir de samples (UI-only). v1.4: speak via MCP.",
    url: `${APP}/dashboard/influencer-ia`,
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
  "personagem-atlas": {
    name: "Personagem-Atlas",
    description:
      "Dossiê editorial premium de personagens sintéticos: 10 slides com tipografia refinada, paleta cromática e geração de conteúdo via IA. É construção de PERSONAGEM ficcional, não o teste de personalidade do user (esse é o persona-sapiens).",
    url: `${APP}/experimentos/personagem-atlas`,
    status: "stable",
    tags: ["personagem", "dossie", "editorial", "slides", "atlas", "character"],
    convex: "characterAtlas",
    mcpReady: false,
  },
  "sapiens-shorts": {
    name: "Sapiens Shorts (UGC / Reflexão)",
    description:
      "Gera shorts verticais 9:16 via VEO. Estilos: ugc, unboxing, app-demo, reflexao. Composição automática persona + screen. v1.5: render via MCP.",
    url: `${APP}/imgen-sapiens-shorts`,
    status: "stable",
    tags: ["video", "shorts", "9:16", "veo", "ugc"],
    convex: "sapiensShortsActions",
    mcpReady: true,
    mcpNote:
      "Coberto via sapiens_shorts (render com brief structured). Compose persona+screen via composeWithImageUrl continua UI-only (compose tem credit refund que mexe em scheduler).",
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
  "comic-builder": {
    name: "Comic Builder (Tirinhas)",
    description:
      "Estúdio oficial de tirinhas/quadrinhos. A IA roteiriza e gera os painéis de dois jeitos: painel a painel (controle fino) ou a tira inteira numa imagem só (estilo e lógica mais travados). Traço dos artigos como estilo base, Helen opcional, diagramação (2×2, tira, vertical) e histórico das tirinhas.",
    url: `${APP}/experimentos/comic-builder`,
    status: "stable",
    tags: ["tirinha", "tirinhas", "comic", "quadrinhos", "hq", "painel", "roteiro", "narrativa"],
    convex: "comicStrips",
    mcpReady: true,
    mcpNote:
      "Coberto via sapiens_pipeline format=tirinha (roteiro: cena + fala dos balões) + sapiens_image pra render. DOIS modos: MODO A tira inteira numa imagem só (1 sapiens_image em grade) ou MODO B painel a painel (N sapiens_image com character-lock por referência). Decida o modo antes de gerar. A imagem sai SEM texto (no-text da casa, modelo erra letra); a fala vai como legenda separada e os balões editáveis + diagramação + histórico finalizam no dashboard. Estúdio canônico de tirinha: não precisa freestyle de prompt.",
  },
  "carrosel-editorial": {
    name: "Carrossel Editorial",
    description:
      "Gerador de carrossel Instagram com templates fixos (role × variant A/B/C), 9 slides Sapiens. Render via Playwright.",
    url: `${APP}/experimentos/carrosel-editorial`,
    status: "stable",
    tags: ["carrossel", "instagram", "editorial", "playwright"],
    convex: "carouselStandalone",
    mcpReady: true,
    mcpNote:
      "Coberto via sapiens_pipeline format=carrossel_ig (texto+imagens). Render Playwright fica no dashboard.",
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
  // action=mine: o STUDIO do user logado (o "Meu Studio", singular), resumo
  // non-PII pro Claude saber o que está montado antes de gerar com useStudio.
  if (args.action === "mine") {
    const sessionToken = getSessionToken();
    const studio = await convexAction("desktopMcp:studioMine", { sessionToken });
    if (!studio) {
      return {
        studio: null,
        note: "Você ainda não tem um studio. Crie em sapiensinteticos.com/dashboard/studio, escolha as ferramentas e ancore a sua marca.",
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
      admin: `${APP}/dashboard/admin/content`,
      note: slug
        ? "URL pública. Pra ver versões anteriores, use sapiens_pipeline list_versions."
        : "publishableId lookup ainda não suportado v1.3. Passe slug.",
    };
  }

  // action=emancipar: o blueprint-mestre da Emancipação (Nível 3). O membro sai
  // da casa do Sapiens e monta a PRÓPRIA, na infra dele, guiado pelo Claude dele.
  if (args.action === "emancipar") {
    const sessionToken = getSessionToken();
    const res: any = await convexQuery(
      "studioBlueprints:mcpEmanciparBlueprint",
      { sessionToken },
    );
    if (!res?.ok) return res; // { ok:false, error } — ex: sem studio montado ainda
    return {
      ...res,
      howto:
        "Blueprint-mestre da Emancipação (Nível 3). VOCÊ (o Claude do membro) constrói a casa dele NUMA PASTA NOVA, fora deste projeto, com Vercel + Convex + domínio DO MEMBRO. O Sapiens NÃO hospeda a casa. Conduza assim: (1) leia o `blueprint` (guia da Fundação) e execute passo a passo, confirmando com o membro ANTES de criar conta ou gastar (domínio); (2) o selo <meta name=\"sapiens-studio\"> é OBRIGATÓRIO pra verificação; (3) com a casa no ar, o membro submete a URL no Sapiens (Rito 'Studio no Ar', que paga Sinapses); (4) pra cada próximo módulo do `modules` que estiver 'ready', chame sapiens_studios action=module module=<slug>. Um módulo por vez, sem atropelar. É um passo grande: vá com calma e no gosto do membro.",
    };
  }

  // action=module: o guia de UM módulo de infra, hidratado com a identidade do
  // studio do membro. Chame depois da fundacao, um por vez.
  if (args.action === "module") {
    if (!args.module) {
      throw new Error(
        "action=module exige 'module' (slug do módulo de infra: fundacao, sapiens-connect, telegram, email, auth).",
      );
    }
    const sessionToken = getSessionToken();
    return await convexQuery("studioBlueprints:mcpModuleBlueprint", {
      sessionToken,
      module: args.module,
    });
  }
}
