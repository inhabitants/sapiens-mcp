/**
 * Prompts MCP: fluxos curados da casa expostos como prompt (viram slash
 * commands no Claude Desktop/Code e aparecem no picker de outros clients).
 * Não adicionam poder novo (tudo já existe via tools): empacotam o CAMINHO
 * CERTO de cada fluxo pra o usuário disparar com um clique, sem depender do
 * modelo lembrar a ordem. Estáticos, sem custo, sem login pra listar.
 */

type PromptArg = { name: string; description: string; required: boolean };

type SapiensPrompt = {
  name: string;
  title: string;
  description: string;
  arguments: PromptArg[];
  /** Monta a mensagem (role user) que instrui o modelo a rodar o fluxo. */
  build: (args: Record<string, string>) => string;
};

export const SAPIENS_PROMPTS: SapiensPrompt[] = [
  {
    name: "comecar",
    title: "Começar no Sapiens",
    description:
      "Porta de entrada: conecta (se preciso) e apresenta saldo + primeiros poderes.",
    arguments: [],
    build: () =>
      "Chame sapiens_meta action=start e me apresente o resultado na voz da casa: " +
      "se eu não estiver conectado, me guie no login (código de " +
      "sapiensinteticos.com/conectar-claude); se estiver, mostre saldo, tier e os " +
      "primeiros poderes com um exemplo pronto de cada. Termine sugerindo por onde começar.",
  },
  {
    name: "capturar-repertorio",
    title: "Capturar obra no Repertório",
    description:
      "Grava um filme/série/anime/jogo/livro/música no seu acervo pessoal (grátis).",
    arguments: [
      {
        name: "obra",
        description:
          "O que você viu/jogou/leu, do seu jeito (ex: 'acabei de ver Duna 2, nota 9').",
        required: true,
      },
    ],
    build: (a) =>
      `Quero registrar no meu Repertório: "${a.obra}". ` +
      "Infira mediaType, status (assisti/zerei/li=completed, tô vendo/jogando=active, " +
      "quero=backlog, dropei=dropped) e nota se eu citei. Use sapiens_repertorio " +
      "action=resolve pra achar a obra nos providers, escolha o candidato certo e grave " +
      "com action=add_item passando SÓ source+externalId do candidato + meus campos " +
      "pessoais. Se o resolve não achar, me diga (não fabrique entry). Só me pergunte " +
      "se houver ambiguidade real entre candidatos.",
  },
  {
    name: "quiz-persona",
    title: "Quiz de Persona (16 arquétipos)",
    description:
      "Aplica o quiz MBTI da casa conversando, calcula o tipo e salva no perfil (grátis).",
    arguments: [],
    build: () =>
      "Quero fazer o quiz de Persona aqui no chat. Puxe as 48 perguntas com " +
      "sapiens_persona action=get_quiz e aplique CONVERSANDO (em blocos curtos, escala " +
      "Likert 1..7, sem me mostrar as 48 de uma vez). No fim, envie minhas respostas com " +
      "action=submit_quiz, me apresente o tipo + breakdown dos 4 eixos, e ofereça gerar " +
      "a arte do meu arquétipo (action=generate, 450 Sinapses) SEM gerar sem eu confirmar.",
  },
  {
    name: "criar-musica",
    title: "Criar música (Musicator)",
    description:
      "Fluxo completo: brief, letra (300 Sinapses) e áudio (3000 Sinapses), com confirmação de custo.",
    arguments: [
      {
        name: "tema",
        description: "Tema/ângulo da música e, se quiser, gênero/mood (ex: 'borderless, lo-fi melancólico').",
        required: true,
      },
    ],
    build: (a) =>
      `Quero criar uma música sobre: "${a.tema}". Antes de gastar, cheque meu saldo ` +
      "(sapiens_meta action=credits) e me confirme os custos (letra 300 + áudio 3000 " +
      "Sinapses). Aí siga o fluxo NA ORDEM: sapiens_musicator action=create (title + " +
      "context ≥20 chars + direction), action=lyrics com o trackId (me mostre a letra), " +
      "e só depois do meu ok no áudio, action=render e acompanhe com action=get até " +
      "ready. Se algo falhar, me explique o que houve antes de tentar de novo.",
  },
  {
    name: "montar-reflexo",
    title: "Montar meu Reflexo (Sintético)",
    description:
      "Destila um Sintético do seu rastro na plataforma: proposta grátis, imagem 450 Sinapses.",
    arguments: [],
    build: () =>
      "Monta o meu Reflexo: chame sapiens_sintetico action=reflexo_propose (grátis) e me " +
      "apresente nome, alma e Cunho propostos. Se eu gostar, pergunte a estética " +
      "(humano/anime/sombra/antropomorfico/espirito/realista/desperto) e gere a imagem " +
      "com action=reflexo_generate (450 Sinapses, só com meu ok). Consagrar o Reflexo em " +
      "Sintético de fato é na web: me aponte o caminho no fim.",
  },
  {
    name: "gerar-imagem",
    title: "Gerar imagem na regra da casa",
    description:
      "Gera imagem com prompt no padrão Sapiens (full-bleed, sujeito oversized), modelo e custo conferidos.",
    arguments: [
      {
        name: "cena",
        description: "O que você quer ver (quem + pose + objeto/conceito).",
        required: true,
      },
    ],
    build: (a) =>
      `Quero uma imagem de: "${a.cena}". Monte o prompt na regra da casa (full-bleed, ` +
      "sujeito oversized 70%+ do frame, sem moldura/margem, sem 'tarot card'). Confira " +
      "modelo e preço com sapiens_image action=models e meu saldo com sapiens_meta " +
      "action=credits; me diga o custo antes de gerar. Se eu tiver studio montado e " +
      "pedir 'do meu jeito', use useStudio=true. Depois de gerar, me mostre a url e " +
      "ofereça publicar na galeria (sapiens_gallery action=publish).",
  },
];

export function listPrompts() {
  return SAPIENS_PROMPTS.map((p) => ({
    name: p.name,
    title: p.title,
    description: p.description,
    arguments: p.arguments,
  }));
}

export function getPrompt(name: string, args: Record<string, string>) {
  const p = SAPIENS_PROMPTS.find((x) => x.name === name);
  if (!p) {
    throw new Error(
      `Prompt desconhecido: ${name}. Disponíveis: ${SAPIENS_PROMPTS.map((x) => x.name).join(", ")}.`,
    );
  }
  for (const arg of p.arguments) {
    if (arg.required && !args[arg.name]?.trim()) {
      throw new Error(`Prompt ${name} exige o argumento "${arg.name}" (${arg.description})`);
    }
  }
  return {
    description: p.description,
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text: p.build(args) },
      },
    ],
  };
}
