/**
 * sapiens_meta action=api: a conta da API da pessoa, SÓ LEITURA.
 *
 * O backend (mcpConta:mcpApiStatus) devolve os números crus; aqui eles viram
 * o resumo na voz da casa, mais os mesmos dados com data legível. Nada daqui
 * assina, move dinheiro, mexe no limite da carteira, liga recarga ou cria
 * chave: isso é no site, com a carteira da pessoa e o segundo fator.
 *
 * Puro de propósito (sem rede): o teste unitário lê do dist.
 */

export type ContaApiCrua = {
  aberta: boolean;
  saldoUsd: number;
  reservadoUsd: number;
  livreUsd: number;
  testeUsd: number;
  testeVenceEm: number | null;
  gastoHojeUsd: number;
  chaves: Array<{
    nome: string;
    prefixo: string;
    tetoDiaUsd: number | null;
    gastoHojeUsd: number;
    ultimoUsoEm: number | null;
    revogada: boolean;
  }>;
  recargaAutomatica: {
    tipo: "cartao" | "stablecoin" | null;
    /** "carteira": a API consome da carteira sem teto do mês (o limite é o gravado na rede); "pacote": recarga com teto do mês. */
    modo?: "carteira" | "pacote" | null;
    ativa: boolean;
    gatilhoUsd: number | null;
    pacoteUsd: number | null;
    tetoMensalUsd: number | null;
    usadoNoMesUsd: number | null;
    estado: string;
  };
  rendimento: {
    ligado: boolean;
    cofre: string;
    termo: string | null;
    termoAtual?: string;
    aceitoEm: number | null;
    termoVencido: boolean;
  };
  links: { api: string; chaves?: string; carteira: string; conectarClaude: string };
};

export const REGRA_SO_LEITURA =
  "Só leitura. Daqui eu não assino, não movo dinheiro, não mudo o limite que você deu pra API na carteira, não ligo recarga e não crio chave: isso é no site, com a sua carteira e o segundo fator.";

/** US$ no jeito da casa: vírgula decimal, duas casas, e até quatro no que é centavo quebrado. */
export function usd(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `US$ ${v.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2,
  })}`;
}

const iso = (ms: number | null | undefined) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** dd/mm em UTC, que é o relógio do vencimento do teste. */
const diaMes = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

function linhaDaRecarga(r: ContaApiCrua["recargaAutomatica"]): string {
  if (!r.tipo) return "Recarga automática desligada.";
  const meio = r.tipo === "stablecoin" ? "em stablecoin (USDC na Base)" : "no cartão";
  if (!r.ativa) return `Recarga automática ${meio}: ${r.estado}.`;
  const estado = r.estado === "ligada" ? "" : ` Agora: ${r.estado}.`;
  // Da carteira sai o que falta pra chamada, nunca menos que o pacote; o cartão cobra o pacote fechado.
  const quanto = (pacote: number) => (r.tipo === "stablecoin" ? `pelo menos ${usd(pacote)} por vez` : `entra ${usd(pacote)}`);
  const quando = r.gatilhoUsd != null && r.pacoteUsd != null ? `quando o livre cai abaixo de ${usd(r.gatilhoUsd)}, ${quanto(r.pacoteUsd)}` : "";
  if (r.modo === "carteira") {
    // O "Usar na API": sem teto do mês. O que segura é o limite gravado na rede pela carteira, que daqui eu não leio.
    const usado = r.usadoNoMesUsd ? ` Este mês já saíram ${usd(r.usadoNoMesUsd)} dali.` : "";
    return `A API consome da sua carteira em stablecoin (USDC na Base)${quando ? ` ${quando}` : ""}, até o limite que você gravou na carteira (no site).${usado}${estado}`;
  }
  const teto =
    r.tetoMensalUsd != null
      ? `, até ${usd(r.tetoMensalUsd)} no mês (${usd(r.usadoNoMesUsd ?? 0)} usados)`
      : "";
  return `Recarga automática ${meio} ligada${quando ? `: ${quando}` : ""}${teto}.${estado}`;
}

function linhaDoRendimento(r: ContaApiCrua["rendimento"]): string | null {
  if (!r.ligado) return r.termo ? `Rendimento desligado (o cofre é o ${r.cofre}).` : null;
  const base = `Rendimento ligado no ${r.cofre}.`;
  return r.termoVencido
    ? `${base} O texto dos riscos mudou depois do seu aceite: pra colocar mais, aceite o termo novo no site. O que já está no cofre segue saindo.`
    : base;
}

/** O retorno do action=api: o resumo curto, os números e a regra do só leitura. */
export function lerContaDaApi(c: ContaApiCrua) {
  const ativas = c.chaves.filter((k) => !k.revogada);
  const revogadas = c.chaves.length - ativas.length;

  const linhas: string[] = [];
  const preso = c.reservadoUsd > 0 ? ` (${usd(c.reservadoUsd)} preso em chamada aberta)` : "";
  linhas.push(`Saldo da API: ${usd(c.saldoUsd)}, livre ${usd(c.livreUsd)}${preso}. É dólar, separado das Sinapses: um não vira o outro.`);
  if (c.testeUsd > 0) {
    linhas.push(
      `Desse saldo, ${usd(c.testeUsd)} é crédito de teste${c.testeVenceEm ? ` e vence em ${diaMes(c.testeVenceEm)}` : ""}. Ele sai primeiro.`,
    );
  }
  linhas.push(`Hoje saiu ${usd(c.gastoHojeUsd)}.`);
  linhas.push(
    ativas.length
      ? `${ativas.length} ${ativas.length === 1 ? "chave ativa" : "chaves ativas"}${revogadas ? `, ${revogadas} ${revogadas === 1 ? "revogada" : "revogadas"}` : ""}.`
      : "Nenhuma chave ativa. Cria em Developers, no site.",
  );
  linhas.push(linhaDaRecarga(c.recargaAutomatica));
  const rend = linhaDoRendimento(c.rendimento);
  if (rend) linhas.push(rend);
  if (c.aberta === false) linhas.push("A porta da API ainda está fechada pro público: você vê porque a conta é admin.");

  return {
    resumo: linhas.join(" "),
    saldo: {
      totalUsd: c.saldoUsd,
      livreUsd: c.livreUsd,
      reservadoUsd: c.reservadoUsd,
      testeUsd: c.testeUsd,
      testeVenceEm: iso(c.testeVenceEm),
      gastoHojeUsd: c.gastoHojeUsd,
    },
    chaves: c.chaves.map((k) => ({ ...k, ultimoUsoEm: iso(k.ultimoUsoEm) })),
    recargaAutomatica: c.recargaAutomatica,
    rendimento: { ...c.rendimento, aceitoEm: iso(c.rendimento.aceitoEm) },
    links: c.links,
    regra: `${REGRA_SO_LEITURA} Recarga, chave e carteira: ${c.links.api}`,
  };
}
