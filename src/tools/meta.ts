import { z } from "zod";
import {
  convexQuery,
  convexMutation,
  convexAction,
  getSessionToken,
  saveSessionToken,
  clearSessionToken,
  describeConvexError,
  isRemoteContext,
} from "../convexClient.js";
import { getMcpVersion } from "../version.js";
import { setTierFromIsAdmin } from "../tier.js";
import { CANAL, comoAtualizar, ondeFicaAChave, type Canal } from "../canal.js";
import { valorDeChave } from "./pontes.js";

const ORIGEM: Record<Canal, string> = {
  npm: "pelo npm (provável cache do npx)",
  mcpb: "pela extensão do Claude Desktop",
  plugin: "pelo plugin do Claude Code",
};

/**
 * Versão do MCP realmente rodando (fonte única em ../version.js, lê o
 * package.json em runtime). Serve pra flagrar client preso em cache antigo do npx.
 */
const readMcpVersion = getMcpVersion;

/**
 * Compara a versão rodando com a última do npm. Best-effort: offline, timeout ou
 * npm fora devolve `latest: null` e ninguém é incomodado.
 *
 * Serve a duas superfícies: `action=version` (diagnóstico sob demanda) e
 * `action=start` (a porta de entrada, que avisa sozinha). Client atrasado é
 * invisível pra quem usa — o agente chama uma rota velha, toma erro do servidor
 * e conclui qualquer coisa. Um cliente do Repertório passou por isso em
 * jul/2026: MCP preso em versão de junho, "adicionei o filme!" sem item nenhum.
 */
async function fetchVersionStatus(): Promise<{
  version: string;
  latest: string | null;
  upToDate: boolean | null;
}> {
  const version = readMcpVersion();
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
        return { version, latest: data.version, upToDate: data.version === version };
      }
    }
  } catch {
    // offline / timeout: reporta só a versão local (ainda útil)
  }
  return { version, latest: null, upToDate: null };
}

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
    "pontes",
    "precos",
  ]),
  code: z
    .string()
    .optional()
    .describe(
      "Código XXXX-XXXX gerado (logado) em sapiensinteticos.com/conectar-claude. Só pra action=login.",
    ),
  midia: z
    .enum(["imagem", "video", "musica", "voz", "texto", "decidir"])
    .optional()
    .describe(
      "Só pra action=precos: recorta a tabela numa mídia. Sem ela vêm imagem, vídeo, música e voz (o texto da API é longo e só vem com midia=texto, com os modelos de preço variável em `texto.roteadores` e a parte `decidir`). midia=decidir traz só os modelos de decisão da API (o Laya): respondem sim ou não, uma opção ou uma nota, sem gerar texto.",
    ),
  busca: z
    .string()
    .optional()
    .describe(
      "Só pra action=precos: filtra pelo nome do motor ou do modelo da API (ex: 'seedance', 'nano banana'), sem acento nem caixa.",
    ),
});

export type MetaArgs = z.infer<typeof metaSchema>;

const APP_URL = "https://sapiensinteticos.com";

const FORMAT_GUIDE: Record<string, { description: string; payloadHint: any }> = {
  carrossel_ig: {
    description:
      "Carrossel do Instagram (o modelo Feed tem 9 slides). O editor renderiza por TEMPLATE: cada slide é { id, templateId, slots, image }. O servidor NORMALIZA todo payload de carrossel: o shape cru antigo ({ title, body, imageUrl } por slide, caption e hashtags no topo) vira slots, foto e meta, mas sai sem layout escolhido, e campo fora do shape some. NÃO monte o payload na mão: use sapiens_pipeline action=generate_carousel_production (sourceId), que cria a production E preenche pelo motor da casa, no shape certo, seguindo o artigo. Depois afine com get_carousel/update_carousel (mesmo shape). O membro opera o carrossel dele pela sapiens_carrossel.",
    payloadHint: {
      meta: {
        caption: "string (legenda do post)",
        hashtags: ["string"],
        keyword: "string MAIÚSCULA (gatilho do comment-to-DM, ex: QUERO)",
      },
      theme: {
        palette: "editorial-ink | editorial-dark | editorial-cream | editorial-bone | feed-preto | feed-floresta | feed-sage (as feed-* são da família de templates *-feed-c)",
        sheet: "4:5 (padrão, o feed mostra inteira) | 9:16 (tela cheia)",
        signature: "{ label, handle, logoUrl } de quem assina a peça; ausente = a casa",
      },
      slides: [
        {
          id: "slide-1",
          templateId: "capa-tipografica-b | corpo-texto-puro-a | corpo-citacao-a | corpo-lista-a | corpo-dado-a | corpo-versus-a | corpo-foto-metade-a | cta-artigo-a (catálogo completo + slots por template vem de get_carousel)",
          slots: { "...": "slots do template escolhido (ex: kicker, title, body)" },
          image: "null, ou objeto { url, focal, zoom } nos templates de foto (url da casa; pra foto da galeria da pessoa, sapiens_carrossel action=set_image)",
        },
      ],
    },
  },
  // post_social, shorts_yt e video_yt saíram do guia em out/2026 (vídeo vive no
  // gerador de vídeo; post de texto perdeu o lugar). Seguem aceitos só como
  // tolerância de validação, ver pipeline.ts.
  // tirinha saiu do guia em ago/2026: peça aposentada (format vive só como
  // tolerância de validação pra productions antigas, ver pipeline.ts).
  musica: {
    description: "Faixa curta com letra + estilo + mood.",
    payloadHint: {
      style: "string ex 'lo-fi hip-hop'",
      mood: "string",
      lyrics: "string completa",
      audioUrl: "string opcional",
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
/**
 * AS PONTES: onde a pessoa pode gerar com crédito PRÓPRIO, com a ficha do
 * personagem daqui, e trazer pro acervo por sapiens_gallery action=ingest.
 *
 * A chave do provedor NUNCA passa pelo Sapiens. O que este catálogo faz é dizer
 * ao harness da pessoa o NOME da variável onde a chave costuma morar, pra ele
 * descobrir sozinho o que ela já tem (`action=pontes` detecta por nome, no
 * stdio, sem ler o valor) e o que cada balcão roda. O passo a passo vive na
 * skill 'pontes'; aqui é só o índice.
 *
 * Só entra balcão que a casa mediu (motor que rodou de verdade por lá). Preço
 * não entra: muda toda semana e a skill diz onde conferir.
 */
const PONTES: {
  key: string;
  nome: string;
  envVars: string[];
  roda: string;
  nota: string;
}[] = [
  {
    key: "kie",
    nome: "Kie",
    envVars: ["KIE_API_KEY"],
    roda: "Kling 3.0, Kling Motion, MiniMax/Hailuo, WAN, Seedance; imagem também",
    nota: "Um endpoint pra tudo (createTask + recordInfo). A URL do render expira em 24h: ingira no mesmo turno.",
  },
  {
    key: "fal",
    nome: "fal.ai",
    envVars: ["FAL_KEY"],
    roda: "Krea 2, Kling, WAN, Seedance, Flux; Krea 2 sem freio existe lá",
    nota: "fal.run síncrono ou queue.fal.run. Slug 'fal-' na casa é classe +18 (sai da vitrine anônima, fica no perfil).",
  },
  {
    key: "wavespeed",
    nome: "WaveSpeed",
    envVars: ["WAVESPEED_API_KEY"],
    roda: "Flux.2 Klein, Krea 2 Livre, WAN 2.2, Kling, Shot Mimic",
    nota: "É o balcão que a casa mais usa por trás do sapiens_video. Slug 'wavespeed-' é classe +18.",
  },
  {
    key: "sogni",
    nome: "Sogni",
    envVars: ["SOGNI_API_KEY"],
    roda: "MiniMax H3 inteira, WAN 2.2 (com animate), LTX 2.3 e 2.5, Krea 2 Turbo, Identity Edit",
    nota: "Assinatura Unlimited cobre o catálogo aberto (custo marginal zero). Um socket por conta: um job por vez.",
  },
  {
    key: "magnific",
    nome: "Magnific / Freepik",
    envVars: [],
    roda: "Seedance 2.0 e 2.5 (até 30s e 1080p), MiniMax H3, upscale, relight",
    nota: "Sem chave: é o conector MCP da Magnific na sessão da pessoa. A URL assinada do render expira no mesmo dia.",
  },
  {
    key: "krea",
    nome: "Krea API",
    envVars: ["KREA_API_KEY"],
    roda: "Krea 2 Turbo/Medium/Large, MiniMax H3 Max Turbo, Seedream, Veo, Seedance",
    nota: "Filtra NSFW; job que falha não cobra. Saldo pré-pago separado do app.",
  },
  {
    key: "replicate",
    nome: "Replicate",
    envVars: ["REPLICATE_API_TOKEN"],
    roda: "catálogo aberto (Flux, WAN, LTX e o que a comunidade sobe)",
    nota: "A casa não mediu motor por lá; o contrato de ingest é o mesmo.",
  },
  {
    key: "openrouter",
    nome: "OpenRouter",
    envVars: ["OPENROUTER_API_KEY"],
    roda: "imagem (Seedream, GPT Image, Gemini) e vídeo (Veo, Seedance) num saldo só",
    nota: "A peça vem atrás da chave (base64 ou download autenticado): a porta local baixa pra máquina e ingere pelo arquivo. A casa ainda não mediu motor por lá.",
  },
  {
    key: "bancada",
    nome: "A própria máquina (ComfyUI, SD local)",
    envVars: [],
    roda: "o que a placa aguenta: LTX, Klein, Krea 2 com LoRA, H3 destilado",
    nota: "Custo zero em dinheiro, pago em tempo. Entra por filePath, slug 'bancada-<motor>'.",
  },
];

/** Os balcões que a sapiens_pontes dirige daqui (os outros vão pelo harness + ingest). */
const PORTA_LOCAL = ["fal", "kie", "wavespeed", "replicate", "openrouter"];

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

// MODO COMPANHIA: puxa o directive de voz de quem está em cena (backend
// companionVoice:mcpGetCompanion). Best-effort — se falhar, o start/whoami segue
// como operador neutro. Devolve:
//   { active:true,  name, avatarUrl, voiceDirective, offer }  -> vista a voz dela
//   { active:false, name, invite, offer }                     -> em cena, mas fora
//   { active:null,  offer }                                   -> sem par, mas tem
//                                                                personagem pra oferecer
//   null                                                      -> nada a fazer
//
// `offer` é o convite pra OFERECER a voz de um personagem de autoria do usuário.
// Vem separado de propósito: quem não tem Sintonia nenhuma também recebe (é
// justamente quem mais ganha em saber que dá pra conversar com o que ele criou).
async function loadCompanion(token: string): Promise<any | null> {
  try {
    const c: any = await convexQuery("companionVoice:mcpGetCompanion", {
      sessionToken: token,
    });
    if (!c) return null;
    const offer = c.characterOffer
      ? { directive: c.characterOffer, characters: c.offerCharacters ?? [] }
      : null;
    if (c.hasSintetico && c.enabled && c.voiceDirective) {
      return {
        active: true,
        name: c.name ?? null,
        avatarUrl: c.avatarUrl ?? null,
        voiceDirective: c.voiceDirective,
        wearing: c.wearing ?? null,
        offer,
      };
    }
    if (c.hasSintetico && !c.enabled && c.inviteDirective) {
      return { active: false, name: c.name ?? null, invite: c.inviteDirective, offer };
    }
    // Sem par (ou par sem alma): ainda vale a pena carregar a oferta.
    if (offer) return { active: null, offer };
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
    // Checagem de versão na porta de entrada: quem está atrasado descobre agora,
    // e não depois de uma tool falhar por rota antiga.
    const ver = await fetchVersionStatus();
    const outdated =
      ver.upToDate === false
        ? {
            clientOutdated: {
              running: ver.version,
              latest: ver.latest,
              // No plugin, somar o remoto por cima duplicaria as tools: lá só
              // vale atualizar o plugin.
              howToFix: [
                comoAtualizar(ver.latest),
                ...(CANAL === "plugin"
                  ? []
                  : [
                      "Ou conectar pelo MCP remoto em sapiensinteticos.com/conectar-claude: ele sai do site, então está sempre na última versão e nunca desatualiza.",
                    ]),
              ],
              note: "AVISE O USUÁRIO já na primeira resposta. Client atrasado chama rotas antigas e falha de um jeito que parece erro do Sapiens (ex: filme que 'foi adicionado' e não entrou no Repertório).",
            },
          }
        : {};
    if (!token) {
      return {
        connected: false,
        ...outdated,
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
      ...outdated,
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
      // A OFERTA: os personagens que o usuário escreveu e que podem entrar em
      // cena. "Incorporar" não é palavra de quem usa, então quem puxa o assunto
      // é o operador, na hora certa. Ver characterOffer no companionVoice.ts.
      ...(companion?.offer
        ? {
            characterOffer: companion.offer.directive,
            offerCharacters: companion.offer.characters,
          }
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
              "Saldo abaixo de 500 Sinapses: o que é grátis roda tranquilo, mas pra imagem/música/vídeo talvez precise recarregar. Outra saída é a outra porta: com a chave dela num provedor (Kie, fal, Magnific, Sogni), gera lá com a ficha do personagem daqui e a peça volta pro acervo, custo zero em Sinapses. No MCP instalado, fal, Kie, WaveSpeed e Replicate saem daqui mesmo por sapiens_pontes action=gerar; o resto volta por sapiens_gallery action=ingest (skill 'pontes'; sapiens_meta action=pontes diz o que ela já tem configurado).",
          }
        : {}),
      firstPowers: FIRST_POWERS,
      startHere,
      // Design system da conta: OFERTA, não default. Imagem avulsa continua
      // saindo crua (quem só quer uma imagem não deve nascer preso num estilo);
      // o artigo do perfil é que já herda o padrão sozinho, porque ali a peça é
      // autoral por definição. Só aparece pra quem realmente tem um.
      ...(who?.designSystem
        ? {
            designSystem: {
              slug: who.designSystem.slug,
              name: who.designSystem.name,
              note: `O design system "${who.designSystem.name}" é o padrão da conta. Artigo do perfil já sai vestido nele. Em imagem avulsa NÃO é automático: ofereça (brandSlug="${who.designSystem.slug}") quando a peça for da marca da pessoa, e deixe cru quando ela só quer uma imagem.`,
            },
          }
        : {}),
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
      note: "Payload é livre (v.any() no schema) e o hint é guia, MENOS no carrossel_ig: ele passa pelo normalizador da casa, e o que estiver fora do shape some.",
    };
  }

  if (args.action === "app_url") {
    return {
      web: APP_URL,
      conectarClaude: `${APP_URL}/conectar-claude`,
      desktopLogin: `${APP_URL}/desktop-login`,
      dashboard: `${APP_URL}/dashboard`,
      adminCuration: `${APP_URL}/dashboard/admin/blog/sapiens-curation`,
      adminPopArticles: `${APP_URL}/dashboard/admin/blog?type=pop-article`,
      adminPipeline: `${APP_URL}/experimentos/content-pipeline`,
    };
  }

  // version: qual versão do sapiens-mcp está rodando AGORA (lida do package.json
  // do binário) + compara com a última do npm (best-effort, com timeout). Não
  // exige login: é sobre o binário, não a conta. É o teste limpo pra saber se o
  // client pegou a versão nova ou ficou preso em cache do npx.
  if (args.action === "version") {
    const { version, latest, upToDate } = await fetchVersionStatus();
    return {
      name: "sapiens-mcp",
      version,
      latest,
      upToDate,
      canal: CANAL,
      runtime: `node ${process.version}`,
      note:
        latest && upToDate === false
          ? `Rodando ${version} ${ORIGEM[CANAL]}, e a última é ${latest}: o client está ATRASADO. Pra atualizar: ${comoAtualizar(latest)}`
          : latest && upToDate
            ? `Na última versão (${version}).`
            : `Versão do binário rodando agora: ${version}. Não consegui consultar o npm pra comparar (offline/timeout).`,
    };
  }

  // Login: troca o código de uso único (gerado no site, logado) por um
  // sessionToken de 90 dias (renovado a cada uso) e salva localmente. NÃO exige
  // token prévio.
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

  // Desconectar de VERDADE: revoga a chave no servidor e só então apaga o
  // arquivo local. Até ago/2026 o logout só limpava o disco, então a chave
  // seguia viva (e válida pra qualquer cópia dela) até vencer sozinha, o que
  // fazia "sair" não cortar nada. A outra porta pro mesmo gesto é a lista de
  // conexões em sapiensinteticos.com/conectar-claude, que corta uma por uma.
  if (args.action === "logout") {
    let token: string | null = null;
    try {
      token = getSessionToken();
    } catch {
      token = null; // já não havia sessão
    }
    let revoked = false;
    if (token) {
      try {
        await convexMutation("desktopAuth:logoutDesktopSession", {
          sessionToken: token,
        });
        revoked = true;
      } catch {
        // best-effort: sem rede, ainda assim apagamos o token local
      }
    }
    const cleared = clearSessionToken();
    setTierFromIsAdmin(null); // sessão foi embora: tier desconhecido, lista cheia
    return {
      ok: true,
      cleared,
      revoked,
      message: revoked
        ? "Desconectado: a chave foi revogada no Sapiens e o token local apagado. Rode action=login pra reconectar."
        : cleared
          ? "Sessão local removida (não consegui falar com o servidor pra revogar a chave; se precisar, corte ela em sapiensinteticos.com/conectar-claude)."
          : "Nenhuma sessão local encontrada.",
    };
  }

  // pontes: o que a pessoa já tem de crédito FORA da casa, e como cada balcão
  // entra. Não exige login e não fala com o backend: é leitura do catálogo
  // acima mais uma olhada nos NOMES das variáveis do ambiente do MCP instalado
  // (o valor nunca é lido nem devolvido; no remoto o processo é o servidor do
  // site, então lá não se olha nada e a resposta manda perguntar).
  if (args.action === "pontes") {
    const remoto = isRemoteContext();
    const detectadas = remoto
      ? []
      : PONTES.filter((p) => p.envVars.some((nome) => Boolean(valorDeChave(nome)))).map(
          (p) => p.key,
        );
    const naPortaLocal = detectadas.filter((k) => PORTA_LOCAL.includes(k));
    return {
      regra:
        "A chave de provedor NUNCA passa pelo Sapiens: ela mora no ambiente da máquina da pessoa e quem chama o motor é um processo de lá (o harness dela, ou o sapiens-mcp instalado pela sapiens_pontes). A casa entra com a ficha do personagem (sapiens_character action=get: passportPrompt + imageUrls) e recebe a peça de volta pelo ingest, que grava motor, prompt verbatim, custo real e personagem. Com a chave dela, gerar custa zero em Sinapses: ela paga o preço do provedor, sem margem da casa. Passo a passo: sapiens_skill action=get name=pontes.",
      detectadas,
      detectadasNota: remoto
        ? "No MCP remoto não dá pra olhar o ambiente da pessoa, e gerar com a chave dela pede o MCP instalado (a chave não sobe pro conector remoto). Pergunte onde ela tem crédito (Kie, fal, Magnific, Sogni, Krea...) ou olhe os conectores que já estão nesta conversa."
        : detectadas.length
          ? `Achei chave configurada (pelo NOME da variável, sem ler o valor) pra: ${detectadas.join(", ")}. Ofereça as duas portas antes de gastar Sinapse.${naPortaLocal.length ? ` ${naPortaLocal.join(" e ")} a casa gera daqui mesmo: sapiens_pontes action=gerar.` : ""}`
          : `Nenhuma variável de provedor no ambiente deste MCP. Pergunte onde a pessoa tem crédito, ou olhe os conectores já ligados nesta conversa (Magnific, Krea, Sogni). Pra fal, Kie, WaveSpeed e Replicate: ${ondeFicaAChave()}`,
      portaLocal: {
        tool: "sapiens_pontes",
        balcoes: PORTA_LOCAL,
        disponivel: !remoto,
        nota: remoto
          ? "Só no MCP instalado: no remoto a tool não existe."
          : "Gera no provedor com a chave desta máquina e traz a peça pro acervo sozinha. Os outros balcões seguem pelo harness + ingest.",
      },
      pontes: PONTES.map((p) => ({
        key: p.key,
        nome: p.nome,
        roda: p.roda,
        envVars: p.envVars,
        nota: p.nota,
        ingestSlug: `${p.key}-<motor>`,
      })),
      voltaPraCasa:
        "sapiens_gallery action=ingest com externalEngine='<provedor>-<motor>', prompt VERBATIM, externalCost na moeda de lá, characterId e referenceImageIds. filePath (arquivo local, só no MCP instalado) ou sourceUrl (o render, que expira: ingira no mesmo turno). unfiltered=true quando o motor rodou sem filtro. Tetos: 12 MB imagem, 60 MB vídeo, 40 peças por dia.",
    };
  }

  const sessionToken = getSessionToken();

  if (args.action === "precos") {
    // A tabela do membro: Sinapses, o dólar da loja (médio e faixa por pacote)
    // e o preço da API quando o motor também está nela. É o que o agente usa
    // pra comparar com fal.ai e WaveSpeed sem chutar câmbio.
    const tabela = await convexQuery("precos:mcpTabela", {
      sessionToken,
      ...(args.midia ? { midia: args.midia } : {}),
      ...(args.busca ? { busca: args.busca } : {}),
    });
    if (!tabela) return { ok: false, error: "A tabela de preço é só pra conta ativa." };
    return tabela;
  }

  if (args.action === "whoami") {
    // mcpGetMySubscription usa requireMcpSession sem admin (qualquer logado
    // com token de acesso cheio; chave da voz e OAuth de parceira não passam),
    // então whoami funciona pra user E admin e reporta o tier pro Claude.
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
      ...(companion?.offer
        ? {
            characterOffer: companion.offer.directive,
            offerCharacters: companion.offer.characters,
          }
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
