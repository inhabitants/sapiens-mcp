import { z } from "zod";
import {
  convexQuery,
  convexMutation,
  convexAction,
  getSessionToken,
  saveSessionToken,
  clearSessionToken,
  describeConvexError,
} from "../convexClient.js";
import { getMcpVersion } from "../version.js";
import { setTierFromIsAdmin } from "../tier.js";

/**
 * Versão do MCP realmente rodando (fonte única em ../version.js, lê o
 * package.json em runtime). Serve pra flagrar client preso em cache antigo do npx.
 */
const readMcpVersion = getMcpVersion;

export const metaSchema = z.object({
  action: z.enum([
    "start",
    "login",
    "logout",
    "whoami",
    "formats",
    "health",
    "credits",
    "app_url",
    "subscription",
    "version",
  ]),
  code: z
    .string()
    .optional()
    .describe(
      "Código XXXX-XXXX gerado (logado) em sapiensinteticos.com/conectar-claude. Só pra action=login.",
    ),
});

export type MetaArgs = z.infer<typeof metaSchema>;

const APP_URL = "https://sapiensinteticos.com";

const FORMAT_GUIDE: Record<string, { description: string; payloadHint: any }> = {
  post_social: {
    description: "Post de texto curto/médio pra rede social (genérico).",
    payloadHint: {
      text: "string PT principal",
      textEn: "string EN (opcional)",
      hashtags: ["string"],
      cta: "string opcional",
    },
  },
  carrossel_ig: {
    description:
      "Carrossel Instagram editorial (7-9 slides). O editor da pipeline renderiza por TEMPLATE: cada slide é { templateId, slots } (não { title, body } cru — esse shape genérico abre VAZIO no editor). NÃO monte o payload na mão: use sapiens_pipeline action=generate_carousel_production (sourceId), que cria a production E preenche pelo motor da casa, no shape certo, seguindo o artigo. Depois afine com get_carousel/update_carousel (mesmo shape editorial). O create_production com payload cru é legado pra quem já tem o shape editorial pronto.",
    payloadHint: {
      meta: {
        caption: "string (legenda do post)",
        hashtags: ["string"],
        keyword: "string MAIÚSCULA (gatilho do comment-to-DM, ex: QUERO)",
      },
      theme: { palette: "editorial-ink | editorial-dark | editorial-cream | editorial-bone" },
      slides: [
        {
          id: "slide-1",
          templateId: "capa-tipografica-b | corpo-texto-puro-a | corpo-citacao-a | corpo-lista-a | corpo-dado-a | corpo-versus-a | corpo-foto-metade-a | cta-artigo-a (catálogo completo + slots por template vem de get_carousel)",
          slots: { "...": "slots do template escolhido (ex: kicker, title, body)" },
          image: "null, ou objeto { url, stockImageId, focal, zoom } nos templates de foto",
        },
      ],
    },
  },
  tirinha: {
    description:
      "Tirinha/quadrinho em painéis (3-6). DOIS modos de imagem: 'strip' (tira inteira numa imagem só, 1 sapiens_image em grade) ou 'panels' (painel a painel, N sapiens_image com character-lock). A imagem SEMPRE sai sem texto; a fala/legenda vive no payload (dialogue/caption) e os balões finalizam no comic-builder do dashboard.",
    payloadHint: {
      title: "string",
      mode: "'strip' (tudo numa imagem) | 'panels' (uma imagem por painel)",
      layout: "string opcional pro modo strip: '2x2' | 'tira' (horizontal) | 'vertical'",
      panels: [
        {
          description: "string narrativo: a CENA visual do painel (vai pro prompt da imagem, SEM texto)",
          dialogue: "string opcional: a fala do balão (NÃO entra na imagem, é legenda)",
          caption: "string opcional: legenda de narração",
          imagePrompt: "string: prompt final do painel (full-bleed, no-text)",
          imageUrl: "string opcional (preenchido depois de gerar)",
        },
      ],
    },
  },
  musica: {
    description: "Faixa curta com letra + estilo + mood.",
    payloadHint: {
      style: "string ex 'lo-fi hip-hop'",
      mood: "string",
      lyrics: "string completa",
      audioUrl: "string opcional",
    },
  },
  shorts_yt: {
    description: "Roteiro pra short vertical de 30-60s.",
    payloadHint: {
      title: "string",
      script: "string roteiro completo",
      scenes: [{ visual: "string", voiceover: "string", duration: "number" }],
    },
  },
  video_yt: {
    description: "Vídeo longer-form.",
    payloadHint: {
      title: "string",
      script: "string roteiro completo",
      scenes: [{ visual: "string", voiceover: "string", duration: "number" }],
    },
  },
  mega_grafico: {
    description:
      "Pôster blueprint denso multi-seção (estilo Pop Chart), texto fiel via gpt-image-2. Tem runner próprio: propose_mega_grafico_plan / run_mega_grafico_full.",
    payloadHint: {
      title: "string",
      sections: [{ heading: "string", items: ["string"] }],
      withHelen: "boolean (1 painel com a Helen interagindo com o tema)",
    },
  },
  aula: {
    description:
      "Aula em slides (deck navegável no site /aulas) destilada do source: framework nomeado + analogia.",
    payloadHint: {
      title: "string",
      slides: [{ title: "string", body: "string", note: "string opcional" }],
    },
  },
};

// Curadoria do action=start: a PORTA DE ENTRADA, não as 29 tools (despejar tudo
// afoga cliente fraco). 6 primeiros poderes, cada um com 1 frase pronta pra
// colar. Voz da casa, espelhando a vitrine /conectar-claude (mantido à mão aqui
// porque o MCP é pacote separado e não importa o examples.ts do app Next).
// NÃO menciona slash command (/sapiens:login etc.): isso só existe no Claude
// Code; Helen/Gemini/Cursor falam só MCP em linguagem natural.
const FIRST_POWERS: { icon: string; title: string; cost: string; try: string }[] =
  [
    {
      icon: "📚",
      title: "Repertório (seu segundo cérebro)",
      cost: "grátis",
      try: "Acabei de ver Duna 2, adiciona no meu repertório, nota 9.",
    },
    {
      icon: "🖼",
      title: "Gerar imagem",
      cost: "~400-500 Sinapses",
      try: "Faz um retrato Sapiens de uma trader degen segurando uma moeda.",
    },
    {
      icon: "✍️",
      title: "Escrever artigo",
      cost: "400 Sinapses",
      try: "Escreve um ensaio sobre solidão usando meus jogos 9+ como lente.",
    },
    {
      icon: "🧬",
      title: "Persona (quiz dos 16 arquétipos)",
      cost: "grátis",
      try: "Quero fazer o quiz de persona aqui no chat.",
    },
    {
      icon: "🪞",
      title: "Reflexo (monta o seu Sintético)",
      cost: "propor de graça · imagem 450",
      try: "Monta o meu Reflexo a partir do meu rastro na plataforma.",
    },
    {
      icon: "🎵",
      title: "Música (Musicator)",
      cost: "letra 300 · áudio 3000 Sinapses",
      try: "Cria uma música sobre borderless na voz Sapiens e já renderiza.",
    },
  ];

// MODO COMPANHIA: puxa o directive de voz do Sintético em Sintonia (backend
// companionVoice:mcpGetCompanion). Best-effort — se falhar ou não houver par,
// o start/whoami segue como operador neutro. Devolve:
//   { active:true,  name, avatarUrl, voiceDirective }  -> vista a voz dela
//   { active:false, name, invite }                     -> tem par, mas fora de cena
//   null                                               -> sem Sintonia (neutro)
async function loadCompanion(token: string): Promise<any | null> {
  try {
    const c: any = await convexQuery("companionVoice:mcpGetCompanion", {
      sessionToken: token,
    });
    if (!c || !c.hasSintetico) return null;
    if (c.enabled && c.voiceDirective) {
      return {
        active: true,
        name: c.name ?? null,
        avatarUrl: c.avatarUrl ?? null,
        voiceDirective: c.voiceDirective,
      };
    }
    if (!c.enabled && c.inviteDirective) {
      return { active: false, name: c.name ?? null, invite: c.inviteDirective };
    }
    return null;
  } catch {
    return null;
  }
}

export async function meta(args: MetaArgs): Promise<any> {
  // start: porta de entrada do primeiro contato. NÃO exige login (esse é o
  // ponto). Sem sessão, ensina a conectar; com sessão, personaliza com
  // nome/tier/saldo e curadoria de primeiros poderes + um "comece por aqui".
  if (args.action === "start") {
    // start é a porta de entrada e NÃO exige login (esse é o ponto). Mas
    // getSessionToken() LANÇA quando não há sessão (nunca retorna vazio), então
    // sem este try/catch o primeiro contato — justo o cenário que o start existe
    // pra resolver — estourava isError em vez de devolver o onboarding curado.
    let token: string | null = null;
    try {
      token = getSessionToken();
    } catch {
      token = null;
    }
    if (!token) {
      return {
        connected: false,
        message:
          "Bem-vindo ao Sapiens Sintéticos. Sua conta ainda não tá conectada aqui no cliente.",
        howToConnect: [
          "1. Entra logado em sapiensinteticos.com/conectar-claude e gera um código XXXX-XXXX (expira em 5 min, uso único).",
          "2. Me passa esse código que eu conecto a sua conta (rodo sapiens_meta action=login).",
        ],
        note: "Sem API key e sem cartão: você opera com as Sinapses que já tem na conta. Conectado, me peça 'o que você faz?' que eu te mostro os primeiros poderes.",
      };
    }
    // best-effort: sem o whoami ainda dá pra entregar um onboarding útil.
    let who: any = null;
    try {
      who = await convexQuery("mcpExtras:mcpGetMySubscription", {
        sessionToken: token,
      });
    } catch {
      // segue sem personalizar
    }
    if (who?.user) setTierFromIsAdmin(!!who.user.isAdmin);
    const isAdmin = !!who?.user?.isAdmin;
    const name = who?.user?.name || who?.user?.email || null;
    const balance = who?.balance?.total ?? null;
    const lowBalance = typeof balance === "number" && balance < 500;
    const startHere = lowBalance
      ? "Com saldo curto pra geração paga, começa pelo que é de graça: marca umas obras no Repertório e faz o quiz de Persona. Eles alimentam todo o resto."
      : "Começa pelo Repertório: marca uma obra que te pegou (filme, jogo, livro, anime). É grátis e vira a matéria-prima que eu puxo depois pra escrever, comparar e criar.";
    // MODO COMPANHIA: se o usuário tem Sintonia e a companhia está ligada, o
    // Sintético dele veste o operador. O directive assume a PRIMEIRA fala.
    const companion = await loadCompanion(token);
    return {
      connected: true,
      // Quando a companhia está ativa, o operador NÃO abre como assistente
      // neutro: incorpora o Sintético (companion.voiceDirective) e dá o oi na
      // voz dele. Este campo vem primeiro de propósito, pra o modelo ver antes.
      ...(companion?.active
        ? {
            companion: {
              active: true,
              name: companion.name,
              avatarUrl: companion.avatarUrl,
              voiceDirective: companion.voiceDirective,
            },
            voiceNote: `IMPORTANTE: a Companhia está ativa. NÃO responda como assistente neutro. Incorpore ${
              companion.name || "o Sintético do usuário"
            } seguindo companion.voiceDirective e abra a conversa com o oi dela. As ferramentas e as Sinapses seguem sendo do usuário.`,
          }
        : {}),
      ...(companion && companion.active === false
        ? { companionInvite: companion.invite }
        : {}),
      greeting: name
        ? `E aí, ${name}. Conectado${isAdmin ? " (tier admin)" : ""}${
            typeof balance === "number" ? `, ${balance} Sinapses na conta` : ""
          }.`
        : "Conta conectada.",
      tier: isAdmin ? "admin" : "user",
      balance,
      ...(lowBalance
        ? {
            balanceWarning:
              "Saldo abaixo de 500 Sinapses: o que é grátis roda tranquilo, mas pra imagem/música/vídeo talvez precise recarregar.",
          }
        : {}),
      firstPowers: FIRST_POWERS,
      startHere,
      moreOnDemand:
        "Isso é só a porta de entrada. Tem também personagens (character-lock), voz (Helen TTS), vídeo, brand/design system, comunidade, fórum e suporte. Peça 'o que mais você faz?' que eu listo, ou já manda o que você quer fazer.",
      ...(isAdmin
        ? {
            adminNote:
              "Tier admin (dono): pipeline editorial, Coluna Sapiens, blog e shorts/vídeo liberados, além de tudo do tier user.",
          }
        : {}),
    };
  }

  if (args.action === "formats") {
    return {
      formats: FORMAT_GUIDE,
      note: "Payload é livre (v.any() no schema). Use o hint como guia, mas pode estender.",
    };
  }

  if (args.action === "app_url") {
    return {
      web: APP_URL,
      conectarClaude: `${APP_URL}/conectar-claude`,
      desktopLogin: `${APP_URL}/desktop-login`,
      dashboard: `${APP_URL}/dashboard`,
      adminCuration: `${APP_URL}/dashboard/admin/blog/sapiens-curation`,
      adminPopArticles: `${APP_URL}/dashboard/admin/repertorio-articles`,
      adminPipeline: `${APP_URL}/dashboard/admin/content`,
    };
  }

  // version: qual versão do sapiens-mcp está rodando AGORA (lida do package.json
  // do binário) + compara com a última do npm (best-effort, com timeout). Não
  // exige login: é sobre o binário, não a conta. É o teste limpo pra saber se o
  // client pegou a versão nova ou ficou preso em cache do npx.
  if (args.action === "version") {
    const version = readMcpVersion();
    let latest: string | null = null;
    let upToDate: boolean | null = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const resp = await fetch("https://registry.npmjs.org/sapiens-mcp/latest", {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        const data: any = await resp.json();
        if (typeof data?.version === "string") {
          latest = data.version;
          upToDate = latest === version;
        }
      }
    } catch {
      // offline / timeout: reporta só a versão local (ainda útil)
    }
    return {
      name: "sapiens-mcp",
      version,
      latest,
      upToDate,
      runtime: `node ${process.version}`,
      note:
        latest && upToDate === false
          ? `Rodando ${version}, mas a última no npm é ${latest}: o client está ATRASADO (provável cache do npx). Pra atualizar: pinar sapiens-mcp@${latest} na config do MCP ou recriar o container (restart sozinho não basta).`
          : latest && upToDate
            ? `Na última versão (${version}).`
            : `Versão do binário rodando agora: ${version}. Não consegui consultar o npm pra comparar (offline/timeout).`,
    };
  }

  // Login: troca o código de uso único (gerado no site, logado) por um
  // sessionToken de 30 dias e salva localmente. NÃO exige token prévio.
  if (args.action === "login") {
    const code = (args.code || "").trim();
    if (!code) {
      throw new Error(
        "Passe o código: action=login com code=XXXX-XXXX. Gere em sapiensinteticos.com/conectar-claude (logado).",
      );
    }
    const token: any = await convexMutation("desktopAuth:redeemDesktopCode", {
      code,
    });
    if (typeof token !== "string" || token.length < 8) {
      throw new Error(
        "Não consegui validar o código. Ele expira em 5 min e é de uso único. Gere um novo em sapiensinteticos.com/conectar-claude.",
      );
    }
    const saved = saveSessionToken(token);
    let who: any = null;
    try {
      who = await convexQuery("mcpExtras:mcpGetMySubscription", {
        sessionToken: token,
      });
    } catch {
      // best-effort: o token foi salvo mesmo que o whoami falhe
    }
    // Conta (possivelmente) trocou: atualiza o tier do tools/list. Sem o
    // whoami, volta a desconhecido (lista cheia) até a próxima leitura.
    setTierFromIsAdmin(who?.user ? !!who.user.isAdmin : null);
    // Detecta um SAPIENS_DESKTOP_SESSION_TOKEN no ambiente que difere do token
    // recém-salvo. Desde a v1.9.1 o login em disco tem prioridade, então esse
    // env é ignorado — mas avisamos pra ninguém ficar confuso com um token
    // velho de .env.local sobrando (era exatamente o que mascarava o login
    // funcionando "pela metade").
    const envTok = process.env.SAPIENS_DESKTOP_SESSION_TOKEN;
    const shadowingEnv =
      !!envTok &&
      envTok !== "PASTE_HERE_AFTER_RUNNING_auth.mjs" &&
      envTok !== token;
    return {
      ok: true,
      message:
        "Conta Sapiens conectada. Já dá pra pedir pra gerar imagem, escrever artigo, etc. (gasta as suas Sinapses).",
      email: who?.user?.email ?? null,
      tier: who?.user?.isAdmin ? "admin" : "user",
      balance: who?.balance?.total ?? null,
      savedTo: saved.path,
      ...(shadowingEnv
        ? {
            note:
              "Achei um SAPIENS_DESKTOP_SESSION_TOKEN no ambiente (.env.local ou config do MCP). " +
              "Desde a v1.9.1 o login em disco tem prioridade, então essa variável é ignorada — pode " +
              "remover essa linha do .env.local pra evitar confusão (ou rode logout pra forçar o uso do env).",
          }
        : {}),
    };
  }

  if (args.action === "logout") {
    const cleared = clearSessionToken();
    setTierFromIsAdmin(null); // sessão foi embora: tier desconhecido, lista cheia
    return {
      ok: true,
      cleared,
      message: cleared
        ? "Sessão local removida. Rode action=login pra reconectar."
        : "Nenhuma sessão local encontrada.",
    };
  }

  const sessionToken = getSessionToken();

  if (args.action === "whoami") {
    // mcpGetMySubscription usa requireMcpUser (qualquer logado), então whoami
    // funciona pra user E admin, e reporta o tier pro Claude saber o que pode.
    const sub = await convexQuery("mcpExtras:mcpGetMySubscription", {
      sessionToken,
    });
    const isAdmin = !!sub?.user?.isAdmin;
    if (sub?.user) setTierFromIsAdmin(isAdmin);
    const companion = await loadCompanion(sessionToken);
    return {
      userId: sub?.user?._id ?? null,
      email: sub?.user?.email ?? null,
      isAdmin,
      tier: isAdmin ? "admin" : "user",
      balance: sub?.balance ?? null,
      warnings: sub?.warnings ?? null,
      ...(companion?.active
        ? {
            companion: {
              active: true,
              name: companion.name,
              avatarUrl: companion.avatarUrl,
              voiceDirective: companion.voiceDirective,
            },
          }
        : companion && companion.active === false
          ? { companionInvite: companion.invite }
          : {}),
      note: isAdmin
        ? "Tier admin (dono): pipeline, blog editorial, Coluna Sapiens e shorts/video, além de tudo do tier user."
        : "Tier user: gerar imagem, escrever artigo (sapiens_write), persona, Helen TTS, Musicator, repertório, comunidade. Cada geração cobra as tuas Sinapses. Pipeline, blog editorial e Coluna são owner-only.",
    };
  }

  if (args.action === "credits") {
    // desktopMcp.whoami já vem com totalCredits (subscription+grants+legacy+free).
    // Usa essa fonte porque pipelineMcp:mcpWhoami só fala dos campos admin.
    const me = await convexAction("desktopMcp:whoami", { sessionToken });
    return {
      email: me?.email ?? null,
      name: me?.name ?? null,
      credits: me?.credits ?? null,
      role: me?.role ?? null,
    };
  }

  if (args.action === "subscription") {
    // Combinação plan + saldo detalhado por bucket (subscription/grants/free)
    const sub: any = await convexQuery("mcpExtras:mcpGetMySubscription", {
      sessionToken,
    });
    if (sub?.user) setTierFromIsAdmin(!!sub.user.isAdmin);
    return sub;
  }

  if (args.action === "health") {
    try {
      // Core: funciona pra qualquer logado (requireMcpUser).
      const sub = await convexQuery("mcpExtras:mcpGetMySubscription", {
        sessionToken,
      });
      const isAdmin = !!sub?.user?.isAdmin;
      if (sub?.user) setTierFromIsAdmin(isAdmin);
      // Pipeline só pra admin (owner-only). Wrap pra nunca derrubar o health.
      let pipeline: any = null;
      if (isAdmin) {
        try {
          const sources = await convexQuery("pipelineMcp:mcpListSources", {
            sessionToken,
          });
          pipeline = {
            sourcesTotal: Array.isArray(sources) ? sources.length : 0,
            sourcesPending: Array.isArray(sources)
              ? sources.filter((s: any) => !s.isDone).length
              : 0,
          };
        } catch {
          pipeline = null;
        }
      }
      return {
        ok: true,
        version: readMcpVersion(),
        tier: isAdmin ? "admin" : "user",
        email: sub?.user?.email ?? null,
        balance: sub?.balance ?? null,
        pipeline,
        appUrl: APP_URL,
      };
    } catch (err: any) {
      return { ok: false, error: describeConvexError(err) };
    }
  }
}
