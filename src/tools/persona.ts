import { z } from "zod";
import {
  convexAction,
  convexQuery,
  convexMutation,
  getSessionToken,
} from "../convexClient.js";

/**
 * Persona Sapiens — quiz MBTI + perfil do user + arte dos 16 arquétipos.
 *
 * PRIMÁRIO (de graça, qualquer conta logada): a pessoa interage com a PRÓPRIA
 * persona, conversando.
 *   - get_quiz: devolve as 48 perguntas (Likert 1..7) + a escala. Estático,
 *     sem auth. Claude aplica o quiz no chat e coleta as respostas.
 *   - submit_quiz: manda as 48 respostas, calcula o resultado server-side e
 *     salva no perfil do user. Refazer cria um profile novo (histórico cresce).
 *   - my_profile: lê o tipo atual (code + persona + eixos com confiança) +
 *     histórico. Pra "qual meu tipo?", "me explica meu perfil", "como evoluí?".
 *
 * SECUNDÁRIO (catálogo + arte):
 *   - list_codes: os 16 codes MBTI + grupo (NT/NF/SJ/SP). Estático.
 *   - list_generated: quais artes de arquétipo já existem (bunnyUrl).
 *   - generate: gera a ilustração de UM arquétipo (450 Sinapses). Combina com
 *     "gera a arte do meu tipo" depois de descobrir o code no quiz.
 *
 * Nota: o scoring é 100% server-side (Convex). O cliente só manda
 * {questionId, value}; o mapeamento eixo/direção é canônico no backend, então
 * mesmo que o texto local aqui fique levemente defasado, o resultado é correto
 * desde que os IDs (ei-1..jp-12) batam.
 */

const MBTI_CODES = [
  "ESFJ", "ISFJ", "ESTJ", "ISTJ",
  "ESFP", "ISFP", "ESTP", "ISTP",
  "ENFP", "INFP", "ENFJ", "INFJ",
  "ENTP", "INTP", "ENTJ", "INTJ",
] as const;

const MBTI_GROUPS: Record<string, string> = {
  ESFJ: "SJ", ISFJ: "SJ", ESTJ: "SJ", ISTJ: "SJ",
  ESFP: "SP", ISFP: "SP", ESTP: "SP", ISTP: "SP",
  ENFP: "NF", INFP: "NF", ENFJ: "NF", INFJ: "NF",
  ENTP: "NT", INTP: "NT", ENTJ: "NT", INTJ: "NT",
};

// Nomes autorais da casa (renome 2026-07-18, sync com o site:
// apps/sapiens/src/app/experimentos/persona-sapiens/data/personas.ts).
const MBTI_NAMES: Record<string, string> = {
  INTJ: "Cientista", INTP: "Cypherpunk",
  ENTJ: "Fundador", ENTP: "Inventor",
  INFJ: "Editor", INFP: "Poeta",
  ENFJ: "Maestro", ENFP: "Faísca",
  ISTJ: "Arquivista", ISFJ: "Guardião",
  ESTJ: "Produtor", ESFJ: "Anfitrião",
  ISTP: "Mecânico", ISFP: "Artesão",
  ESTP: "Negociador", ESFP: "Streamer",
};

// Escala Likert 1..7 (mesma do quiz no site).
const LIKERT_SCALE: Record<number, string> = {
  1: "Discordo totalmente",
  2: "Discordo",
  3: "Discordo um pouco",
  4: "Neutro",
  5: "Concordo um pouco",
  6: "Concordo",
  7: "Concordo totalmente",
};

// Descrição curta de cada eixo (pra Claude contextualizar as perguntas).
const AXES_INFO: Record<string, string> = {
  EI: "Extroversão vs Introversão — de onde a pessoa tira energia.",
  SN: "Sensorial vs Intuitivo — como capta informação (fatos vs padrões).",
  TF: "Pensamento vs Sentimento — como decide (lógica vs impacto humano).",
  JP: "Julgador vs Perceptivo — como lida com o mundo (fecha vs deixa aberto).",
};

// ============================================================
// BANCO DE 48 PERGUNTAS (12 por eixo).
//
// SYNC: cópia do texto de
//   apps/sapiens/src/app/experimentos/persona-sapiens/data/questions.ts
// Os IDs + a ordem batem com QUESTIONS_CONFIG em
//   apps/sapiens/convex/personalityProfiles.ts (fonte canônica do scoring).
// Se mudar pergunta no site, atualize os DOIS lá E este array. O scoring é
// server-side: só os IDs importam pro resultado, o texto é o que o user lê.
// ============================================================
const QUIZ_QUESTIONS: Array<{ id: string; axis: "EI" | "SN" | "TF" | "JP"; text: string }> = [
  // ===== EIXO E vs I =====
  { id: "ei-1", axis: "EI", text: "Em festas grandes, eu saio mais energizado do que cansado." },
  { id: "ei-2", axis: "EI", text: "Antes de uma decisão importante, eu prefiro pensar sozinho a conversar com alguém." },
  { id: "ei-3", axis: "EI", text: "Conhecer pessoas novas me energiza mais do que me cansa." },
  { id: "ei-4", axis: "EI", text: "Conheço melhor um pequeno círculo íntimo do que muitos conhecidos." },
  { id: "ei-5", axis: "EI", text: "Eu penso melhor falando em voz alta do que em silêncio." },
  { id: "ei-6", axis: "EI", text: "Reuniões longas com muita gente me drenam." },
  { id: "ei-7", axis: "EI", text: "Tenho facilidade pra puxar conversa com estranhos." },
  { id: "ei-8", axis: "EI", text: "Recarrego minhas energias em silêncio, sozinho." },
  { id: "ei-9", axis: "EI", text: "Em ambientes muito quietos, eu sinto que algo está faltando." },
  { id: "ei-10", axis: "EI", text: "Eu prefiro mensagens escritas a ligações telefônicas." },
  { id: "ei-11", axis: "EI", text: "Penso em voz alta com outras pessoas porque o pensamento precisa de ar." },
  { id: "ei-12", axis: "EI", text: "Depois de um dia social intenso, eu preciso de horas sozinho pra processar." },

  // ===== EIXO S vs N =====
  { id: "sn-1", axis: "SN", text: "Eu confio mais em fatos verificáveis do que em palpites." },
  { id: "sn-2", axis: "SN", text: "Frequentemente percebo conexões e padrões que outros não enxergam." },
  { id: "sn-3", axis: "SN", text: "Prefiro lidar com problemas concretos a especular sobre futuros possíveis." },
  { id: "sn-4", axis: "SN", text: "Tenho prazer em pensar em ideias abstratas, mesmo sem aplicação imediata." },
  { id: "sn-5", axis: "SN", text: "Valorizo experiência prática mais do que teoria." },
  { id: "sn-6", axis: "SN", text: "Fico inquieto se passo muito tempo sem imaginar possibilidades novas." },
  { id: "sn-7", axis: "SN", text: "Quando descrevo algo, prefiro ser preciso e específico." },
  { id: "sn-8", axis: "SN", text: "Tenho facilidade pra falar de ideias hipotéticas que ainda não testei." },
  { id: "sn-9", axis: "SN", text: "Eu noto detalhes pequenos antes de ver o quadro geral." },
  { id: "sn-10", axis: "SN", text: "Metáforas e símbolos fazem mais sentido pra mim do que listas e dados." },
  { id: "sn-11", axis: "SN", text: "Prefiro confiar no manual a improvisar quando aprendo algo novo." },
  { id: "sn-12", axis: "SN", text: "Eu costumo pensar em como as coisas poderiam ser diferentes do que são." },

  // ===== EIXO T vs F =====
  { id: "tf-1", axis: "TF", text: "Em decisão difícil, eu listo prós e contras antes de sentir o que quero." },
  { id: "tf-2", axis: "TF", text: "Quando alguém me conta um problema, primeiro me coloco no lugar antes de raciocinar." },
  { id: "tf-3", axis: "TF", text: "Prefiro um diagnóstico honesto, mesmo brusco, a um conforto vago." },
  { id: "tf-4", axis: "TF", text: "Harmonia no grupo é tão importante quanto chegar à decisão certa." },
  { id: "tf-5", axis: "TF", text: "Quando dou feedback, vou direto ao problema antes de cuidar do clima." },
  { id: "tf-6", axis: "TF", text: "Em conflitos, eu tento entender o que cada lado está sentindo antes de tomar partido." },
  { id: "tf-7", axis: "TF", text: "Eu tendo a aplicar o mesmo critério pra todo mundo, em vez de pesar caso a caso." },
  { id: "tf-8", axis: "TF", text: "Eu peso o impacto emocional de uma decisão tanto quanto a lógica dela." },
  { id: "tf-9", axis: "TF", text: "Quando alguém defende uma ideia com paixão, isso pesa pouco no que eu acho da ideia." },
  { id: "tf-10", axis: "TF", text: "Eu reconheço o tom emocional de uma sala antes mesmo das palavras." },
  { id: "tf-11", axis: "TF", text: "Decidir o que é melhor pra alguém fica mais fácil quando eu deixo o que ela sente de fora." },
  { id: "tf-12", axis: "TF", text: "Eu tendo a perdoar quando entendo a história por trás do erro." },

  // ===== EIXO J vs P =====
  { id: "jp-1", axis: "JP", text: "Gosto de fechar decisões logo, em vez de deixar abertas." },
  { id: "jp-2", axis: "JP", text: "Mantenho opções em aberto até o último momento, porque algo melhor pode aparecer." },
  { id: "jp-3", axis: "JP", text: "Listas, agendas e prazos me fazem render mais." },
  { id: "jp-4", axis: "JP", text: "Estou confortável quando o plano muda no meio do caminho." },
  { id: "jp-5", axis: "JP", text: "Espaço bagunçado me incomoda até eu organizar." },
  { id: "jp-6", axis: "JP", text: "Prefiro começar muitas coisas a terminar uma só." },
  { id: "jp-7", axis: "JP", text: "Eu prefiro entregar antes do prazo do que no limite dele." },
  { id: "jp-8", axis: "JP", text: "Rotinas rígidas me sufocam, eu rendo melhor com estrutura solta." },
  { id: "jp-9", axis: "JP", text: "Quando começo um projeto, já visualizo a entrega e o prazo final." },
  { id: "jp-10", axis: "JP", text: "Adiar decisões pequenas me dá uma sensação de liberdade." },
  { id: "jp-11", axis: "JP", text: "Programas de viagem detalhados me deixam tranquilo, não entediado." },
  { id: "jp-12", axis: "JP", text: "Eu tendo a deixar várias abas mentais abertas ao mesmo tempo." },
];

// ============================================================
// BLOCO DA CASA: par de jogo (8 perguntas de vínculo, OPCIONAIS).
// Não mudam o tipo; medem COMO a pessoa quer ser acompanhada (2 eixos:
// Sparring↔Acolhimento, Direção↔Execução) → 1 de 4 modos de parceiro
// (Mestre de Jogo, Sparring, Farol, Copiloto), que calibra o Sintético dela.
// SYNC: espelho de data/vinculoQuestions.ts (site) e VINCULO_CONFIG
// (convex/personalityProfiles.ts, scoring server-side).
// ============================================================
const VINCULO_QUESTIONS: Array<{ id: string; axis: "SA" | "DE"; text: string }> = [
  { id: "vn-sa-1", axis: "SA", text: "Rendo mais quando alguém discorda de mim com força." },
  { id: "vn-sa-2", axis: "SA", text: "Quando travo, o que me destrava é escuta, não cobrança." },
  { id: "vn-sa-3", axis: "SA", text: "Prefiro um 'isso tá fraco' na cara a um elogio morno." },
  { id: "vn-sa-4", axis: "SA", text: "Ideia recém-nascida precisa de espaço seguro antes de aguentar pancada." },
  { id: "vn-de-1", axis: "DE", text: "Quero alguém que aponte o caminho e me deixe caminhar sozinho." },
  { id: "vn-de-2", axis: "DE", text: "Plano bom é plano que alguém constrói comigo, mão na massa." },
  { id: "vn-de-3", axis: "DE", text: "Um bom mapa me serve mais que companhia na trilha." },
  { id: "vn-de-4", axis: "DE", text: "Ideia boa minha morre por falta de alguém segurando a ponta prática." },
];

const VINCULO_AXES_INFO: Record<string, string> = {
  SA: "Sparring vs Acolhimento — a pessoa quer que a confrontem ou que a sustentem.",
  DE: "Direção vs Execução — quer quem aponta o caminho ou quem senta e faz junto.",
};

export const personaSchema = z.object({
  action: z.enum([
    "my_profile",
    "get_quiz",
    "submit_quiz",
    "list_codes",
    "list_generated",
    "generate",
  ]),
  code: z
    .enum(MBTI_CODES)
    .optional()
    .describe("Pra action=generate: código MBTI a gerar a arte. Case-insensitive (normaliza pra maiúscula)."),
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        value: z.number().int().min(1).max(7),
      }),
    )
    .optional()
    .describe("Pra action=submit_quiz: as 48 respostas { questionId, value 1..7 }. Pegue os IDs/perguntas com action=get_quiz e colete tudo antes."),
  vinculoAnswers: z
    .array(
      z.object({
        questionId: z.string(),
        value: z.number().int().min(1).max(7),
      }),
    )
    .optional()
    .describe("Pra action=submit_quiz: as 8 respostas do bloco da casa (par de jogo, ids vn-*). Opcional, mas recomendado: destrava o modo de parceiro e a calibração do Sintético."),
  nome: z
    .string()
    .optional()
    .describe("Pra action=submit_quiz: nome opcional pra personalizar o resultado salvo."),
});

export type PersonaArgs = z.infer<typeof personaSchema>;

export async function persona(args: PersonaArgs): Promise<any> {
  // -------- get_quiz: as 48 perguntas pra aplicar conversando (estático) --------
  if (args.action === "get_quiz") {
    return {
      totalQuestions: QUIZ_QUESTIONS.length + VINCULO_QUESTIONS.length,
      scale: LIKERT_SCALE,
      axes: AXES_INFO,
      instructions:
        "Aplique conversando: apresente as perguntas (pode ir em blocos por eixo) e " +
        "peça pra pessoa responder de 1 (Discordo totalmente) a 7 (Concordo totalmente). " +
        "Junte TODAS as 48 respostas de `questions` e chame action=submit_quiz com answers=[{questionId, value}]. " +
        "Depois das 48, aplique também o BLOCO DA CASA (`vinculoQuestions`, 8 itens, mesma escala): " +
        "ele descobre o par de jogo da pessoa (como ela quer ser acompanhada) e calibra o Sintético dela. " +
        "Essas 8 vão SEPARADAS, no arg vinculoAnswers. " +
        "Não calcule o resultado você mesmo: o scoring é server-side.",
      questions: QUIZ_QUESTIONS,
      vinculoQuestions: VINCULO_QUESTIONS,
      vinculoAxes: VINCULO_AXES_INFO,
      howToSubmit:
        "sapiens_persona action=submit_quiz answers=[{questionId:'ei-1', value:5}, ...] (48 itens) " +
        "vinculoAnswers=[{questionId:'vn-sa-1', value:6}, ...] (8 itens, opcional).",
    };
  }

  // -------- submit_quiz: salva o resultado no perfil do user (de graça) --------
  if (args.action === "submit_quiz") {
    const answers = args.answers ?? [];
    if (answers.length < QUIZ_QUESTIONS.length) {
      throw new Error(
        `Quiz incompleto: ${answers.length}/${QUIZ_QUESTIONS.length} respostas. ` +
          "Pegue as perguntas com action=get_quiz e colete todas (valor 1..7) antes de submeter.",
      );
    }
    const sessionToken = getSessionToken();
    const res: any = await convexMutation("mcpExtras:mcpSubmitPersonaQuiz", {
      sessionToken,
      answers: answers.map((a) => ({ questionId: a.questionId, value: a.value })),
      // Bloco da casa (par de jogo): opcional; só vai se coletado completo.
      ...(args.vinculoAnswers?.length
        ? { vinculoAnswers: args.vinculoAnswers.map((a) => ({ questionId: a.questionId, value: a.value })) }
        : {}),
      nome: args.nome,
    });
    return {
      ...res,
      name: MBTI_NAMES[res.code] ?? null,
      group: MBTI_GROUPS[res.code] ?? null,
      fullUrl: res.url ? `https://sapiensinteticos.com${res.url}` : null,
      note:
        "Resultado salvo no seu perfil. Pra ver/discutir depois: action=my_profile. " +
        "Pra a arte do seu tipo: action=generate code=" +
        (res.code ?? "<code>") +
        " (450 Sinapses).",
    };
  }

  // -------- my_profile: lê o tipo atual + histórico do user --------
  if (args.action === "my_profile") {
    const sessionToken = getSessionToken();
    return await convexQuery("mcpExtras:mcpGetMyPersona", { sessionToken });
  }

  // -------- list_codes: catálogo estático dos 16 arquétipos --------
  if (args.action === "list_codes") {
    return {
      count: MBTI_CODES.length,
      codes: MBTI_CODES.map((c) => ({
        code: c,
        name: MBTI_NAMES[c],
        group: MBTI_GROUPS[c],
      })),
      groups: {
        NT: "Direção (traça o rumo, pensa em sistemas)",
        NF: "Roteiro (escreve o sentido, pensa em pessoas)",
        SJ: "Produção (faz rodar, pensa em ordem)",
        SP: "Cena (joga em tempo real, pensa em sensação)",
      },
    };
  }

  // -------- list_generated: quais artes já existem no banco --------
  if (args.action === "list_generated") {
    // personaArtData.getAll é query pública sem auth check explícito
    // (read-only, tabela de 16 rows fixos). Sem session token necessário.
    const rows = await convexQuery("personaArtData:getAll", {});
    return {
      count: Array.isArray(rows) ? rows.length : 0,
      generated: (rows || []).map((r: any) => ({
        code: r.code,
        name: MBTI_NAMES[r.code],
        group: MBTI_GROUPS[r.code],
        bunnyUrl: r.bunnyUrl ?? null,
        updatedAt: r.updatedAt ?? r._creationTime ?? null,
      })),
      note: "Apenas codes que já foram gerados. Pra ver os 16 possíveis (gerados ou não), use action=list_codes.",
    };
  }

  // -------- generate: arte de 1 arquétipo (450 Sinapses, qualquer logado) --------
  if (args.action === "generate") {
    if (!args.code) {
      throw new Error("action=generate exige code MBTI (ex 'INTJ').");
    }
    const sessionToken = getSessionToken();
    return await convexAction("mcpExtrasActions:mcpGeneratePersonaArt", {
      sessionToken,
      code: args.code,
    });
  }
}
