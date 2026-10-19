import { z } from "zod";
import { convexQuery, convexMutation, getSessionToken } from "../convexClient.js";

/**
 * sapiens_decupagem — o acervo de réguas de linguagem cinematográfica da casa.
 *
 * O que MEDE é o motor local (`tools/decupagem/decupa.py`, Python + OpenCV +
 * ffmpeg): não existe OpenCV em serverless, então a medição roda na máquina,
 * igual à produção dos Vídeos Programáticos. Esta tool é a outra ponta: sobe a
 * ficha que o motor produziu e consulta o que já foi decupado.
 *
 * O fluxo que fecha o ciclo:
 *   1. `python tools/decupagem/decupa.py "<arquivo ou link>"`
 *   2. lê `fichas/<slug>/ficha.json`
 *   3. `sapiens_decupagem action=save` com o conteúdo dela
 *   4. a ficha aparece no Lab (/experimentos/decupagem) e entra no comparador
 *
 * O acervo vale pelo CONJUNTO: uma ficha é morna, vinte lado a lado são a
 * biblioteca de gramática da casa (plano mediano, quem carrega o movimento,
 * registro de luz, se o corte obedece ao som). Antes de decupar uma referência
 * nova, `action=list` mostra o que já tem e evita medir a mesma coisa duas
 * vezes.
 *
 * Admin-only: o acervo é material interno. Não cobra Sinapse.
 */

export const decupagemSchema = z.object({
  action: z.enum(["list", "get", "save", "note", "delete"]),
  slug: z
    .string()
    .optional()
    .describe(
      "Pra get/save/note/delete. É a chave do acervo: salvar de novo com o " +
        "mesmo slug ATUALIZA a ficha em vez de duplicar (redecupar depois de " +
        "afinar o motor é comum).",
    ),
  ficha: z
    .any()
    .optional()
    .describe(
      "Pra save: o conteúdo INTEIRO de fichas/<slug>/ficha.json, como o motor " +
        "produziu. Não resuma nem reescreva: o Lab lê os campos de dentro.",
    ),
  nota: z
    .string()
    .optional()
    .describe(
      "Pra save/note: a LEITURA editorial, escrita por quem olhou (o que dá " +
        "pra roubar, o que não dá). O motor mede, isto interpreta, e os dois " +
        "não se misturam na ficha.",
    ),
});

export type DecupagemArgs = z.infer<typeof decupagemSchema>;

export async function decupagem(args: DecupagemArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "list") {
    const fichas: any = await convexQuery("decupagens:mcpListar", { sessionToken });
    const n = Array.isArray(fichas) ? fichas.length : 0;
    return {
      count: n,
      fichas,
      note:
        n === 0
          ? "Acervo vazio. Rode o motor local (python tools/decupagem/decupa.py) e suba com action=save."
          : "Régua de cada referência. Pra ficha inteira (planos, luz, som): action=get slug=<slug>.",
    };
  }

  if (args.action === "get") {
    if (!args.slug) throw new Error("sapiens_decupagem get: exige slug.");
    const ficha: any = await convexQuery("decupagens:mcpPegar", {
      sessionToken,
      slug: args.slug,
    });
    if (!ficha) {
      return {
        found: false,
        note: `Nenhuma ficha com slug '${args.slug}'. Veja o acervo com action=list.`,
      };
    }
    return { found: true, ficha };
  }

  if (args.action === "save") {
    if (!args.ficha) {
      throw new Error(
        "sapiens_decupagem save: exige `ficha` (o ficha.json inteiro que o " +
          "motor gerou em tools/decupagem/fichas/<slug>/).",
      );
    }
    const f = args.ficha;
    const resumo = extrairResumo(f, args.slug);
    const r: any = await convexMutation("decupagens:mcpSalvar", {
      sessionToken,
      ...resumo,
      ficha: f,
      nota: args.nota,
    });
    return {
      ok: true,
      slug: resumo.slug,
      criado: r?.criado ?? null,
      note:
        `Ficha de '${resumo.titulo}' no acervo (${resumo.planos} planos, ` +
        `plano mediano ${resumo.durPlanoMediana}s, ${resumo.escola}). ` +
        `Aparece no Lab em /experimentos/decupagem.`,
    };
  }

  if (args.action === "note") {
    if (!args.slug || !args.nota) {
      throw new Error("sapiens_decupagem note: exige slug e nota.");
    }
    await convexMutation("decupagens:mcpSalvarNota", {
      sessionToken,
      slug: args.slug,
      nota: args.nota,
    });
    return { ok: true, note: "Leitura anotada na ficha." };
  }

  if (args.action === "delete") {
    if (!args.slug) throw new Error("sapiens_decupagem delete: exige slug.");
    const r: any = await convexMutation("decupagens:mcpApagar", {
      sessionToken,
      slug: args.slug,
    });
    return {
      ok: true,
      apagado: r?.apagado ?? false,
      note: r?.apagado ? "Ficha removida do acervo." : "Não havia ficha com esse slug.",
    };
  }

  throw new Error(`sapiens_decupagem: action desconhecida '${args.action}'.`);
}

/**
 * Puxa as colunas que o Lab ordena e filtra de dentro da ficha do motor.
 *
 * O resto da medição vai inteiro pro campo `ficha`: o motor ganhou dolly,
 * concentração de matiz, ilha de cor e leitura semântica em uma semana, e
 * promover cada medida nova a coluna faria o schema virar gargalo.
 */
function extrairResumo(f: any, slugArg?: string) {
  const fonte = f?.fonte ?? {};
  const cont = f?.container ?? {};
  const ritmo = f?.ritmo ?? {};
  const mov = f?.movimento ?? {};
  const luz = f?.luz ?? {};
  const som = f?.som ?? {};
  const cad = f?.cadencia ?? {};

  const titulo = String(fonte.titulo || fonte.arquivo || "sem titulo");
  const slug = (slugArg || slugify(titulo)).slice(0, 80);
  if (!slug) throw new Error("sapiens_decupagem save: não consegui derivar o slug.");

  const num = (x: any, def = 0) => (typeof x === "number" && isFinite(x) ? x : def);
  // O veredito de sincronia é o do teste de IMPACTO quando existe: o teste
  // geral satura em trilha densa e vira "sem relação" pra todo mundo.
  const sinc = som?.sincronia_impacto ?? som?.sincronia_grade ?? som?.sincronia;

  return {
    slug,
    titulo: titulo.slice(0, 200),
    origem: String(fonte.origem || "local"),
    entrada: fonte.entrada ? String(fonte.entrada).slice(0, 500) : undefined,
    dur: num(cont.dur),
    planos: num(ritmo.planos),
    durPlanoMediana: num(ritmo.dur_mediana),
    escola: String(ritmo.escola || "").slice(0, 120),
    movTotalPct: num(mov.total_pct_s),
    movCameraPct: num(mov.camera_pct_s),
    movSujeitoPct: num(mov.sujeito_pct_s),
    registro: String(luz.registro || "").slice(0, 160),
    cadenciaReal: num(cad.cadencia_real),
    bpm: typeof som.bpm === "number" ? som.bpm : undefined,
    corteNoSom: sinc?.veredito ? String(sinc.veredito).slice(0, 160) : undefined,
  };
}

function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
