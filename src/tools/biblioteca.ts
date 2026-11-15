/**
 * sapiens_meta action=biblioteca: o mapa do que a casa tem ABERTO. Os projetos
 * open source (skill, kit, plugin, jogo), cada um com a licença, o link e a
 * frase de instalar, e os modelos que a casa solta no Civitai. Sem login e sem
 * custo: serve o membro e quem ainda não é.
 *
 * POR QUE LÊ DO SITE E NÃO EMBUTE O CATÁLOGO NO PACOTE
 *
 * O catálogo tem dono: o `freeStuff.mjs` do site, de onde a home e a
 * /free-stuff já leem. As duas saídas eram embutir uma cópia dele no build do
 * pacote ou ler de um endpoint do site (GET /api/biblioteca). Ficou o endpoint:
 *
 *  1. Pacote publicado envelhece na máquina de quem instalou (cache do npx,
 *     extensão sem atualizar). Com a cópia embutida, item novo só chegaria a
 *     quem atualizasse; lendo do site, chega em toda versão instalada no mesmo
 *     dia, sem release.
 *  2. Metade do mapa nem é catálogo: os modelos vêm vivos da API do Civitai, e
 *     o filtro que decide o que é SFW (com a exceção de capa travada) mora no
 *     site. Embutir obrigaria a copiar esse filtro pra cá, e duas cópias de um
 *     filtro de +18 desalinham justo onde não podem.
 *  3. Os dois transportes leem o mesmo JSON: o remoto roda dentro do site e o
 *     stdio na máquina da pessoa, e nenhum dos dois decide nada por conta.
 *
 * O preço é precisar de rede. Sem ela (ou com o pacote na frente do push do
 * site) a resposta não quebra: volta `ok: false` com a página /free-stuff, que
 * tem a mesma lista pra olho humano.
 *
 * O JSON do site é contrato aditivo (src/lib/bibliotecaAberta.ts do app): aqui
 * só se lê campo, e campo que faltar vira null em vez de erro.
 */

export const BIBLIOTECA_URL = "https://www.sapiensinteticos.com/api/biblioteca";

export type Idioma = "pt" | "en";

const PAGINA: Record<Idioma, string> = {
  pt: "https://www.sapiensinteticos.com/free-stuff",
  en: "https://www.sapiensinteticos.com/en/free-stuff",
};
const GITHUB = "https://github.com/inhabitants";

const TEXTO = {
  pt: {
    resumo: (p: number, m: number) =>
      `A casa tem ${p} ${p === 1 ? "projeto aberto" : "projetos abertos"}` +
      (m ? ` e ${m} ${m === 1 ? "modelo" : "modelos"} no Civitai` : "") +
      ". Tudo grátis, sem conta no Sapiens.",
    comoUsar:
      "Projeto: a frase de `instalar.texto` é pra colar num agente (Claude Code, Cursor, Codex), que lê o endereço e instala sozinho; se você É o agente, siga ela. `instalar: null` roda no navegador: abra `pagina`. Modelo: baixa em `url`. A licença de cada um está no campo `licenca`; cite de onde veio.",
    semModelos:
      "A lista de modelos não veio agora (o Civitai não respondeu). Ela está na página da biblioteca.",
    fora: "Não consegui ler a biblioteca agora. A mesma lista está na página, e os repos no GitHub da casa.",
  },
  en: {
    resumo: (p: number, m: number) =>
      `The house has ${p} open ${p === 1 ? "project" : "projects"}` +
      (m ? ` and ${m} ${m === 1 ? "model" : "models"} on Civitai` : "") +
      ". All free, no Sapiens account needed.",
    comoUsar:
      "Project: the `instalar.texto` line is meant to be pasted into an agent (Claude Code, Cursor, Codex), which reads the address and sets it up; if you ARE the agent, follow it. `instalar: null` runs in the browser: open `pagina`. Model: download at `url`. Each license is in `licenca`; credit the source.",
    semModelos:
      "The model list did not come through (Civitai did not answer). It is on the library page.",
    fora: "Could not read the library right now. The same list is on the page, and the repos are on the house GitHub.",
  },
};

const lado = (v: any, idioma: Idioma): string | null => {
  if (typeof v === "string") return v;
  const s = v?.[idioma] ?? v?.pt ?? v?.en;
  return typeof s === "string" ? s : null;
};

/** O JSON do site vira a resposta da tool, numa língua só. Puro, pra testar sem rede. */
export function montarBiblioteca(mapa: any, idioma: Idioma) {
  const t = TEXTO[idioma];
  const itens: any[] = Array.isArray(mapa?.itens) ? mapa.itens : [];
  const modelos: any[] = Array.isArray(mapa?.modelos) ? mapa.modelos : [];
  return {
    ok: true,
    resumo: t.resumo(itens.length, modelos.length),
    comoUsar: t.comoUsar,
    pagina: lado(mapa?.pagina, idioma) ?? PAGINA[idioma],
    github: typeof mapa?.github === "string" ? mapa.github : GITHUB,
    projetos: itens.map((i) => ({
      nome: lado(i?.nome, idioma),
      tipo: lado(i?.tipo, idioma),
      oQueE: lado(i?.linha, idioma),
      licenca: i?.licenca ?? null,
      repo: i?.repo ?? null,
      pagina: lado(i?.pagina, idioma),
      instalar: i?.instalar
        ? { onde: lado(i.instalar.onde, idioma), texto: lado(i.instalar.texto, idioma) }
        : null,
    })),
    modelos: modelos.map((m) => ({
      nome: m?.nome ?? null,
      tipo: m?.tipo ?? null,
      base: m?.base ?? null,
      linha: m?.linha ?? null,
      url: m?.url ?? null,
    })),
    ...(modelos.length ? {} : { modelosNota: t.semModelos }),
  };
}

export async function lerBiblioteca(idioma: Idioma = "pt") {
  try {
    const resp = await fetch(BIBLIOTECA_URL, {
      headers: { accept: "application/json", "user-agent": "sapiens-mcp" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const mapa: any = await resp.json();
    if (!Array.isArray(mapa?.itens)) throw new Error("resposta sem itens");
    return montarBiblioteca(mapa, idioma);
  } catch {
    // Offline, timeout, ou pacote na frente do push do site (404): o caminho
    // humano continua de pé e o agente não fica sem resposta.
    return { ok: false, erro: TEXTO[idioma].fora, pagina: PAGINA[idioma], github: GITHUB };
  }
}
