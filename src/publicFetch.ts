import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import type { IncomingMessage } from "node:http";

/**
 * Download de URL que veio de um AGENTE (sourceUrl de upload, ingest, fonte).
 * No transporte remoto o pedido sai do NOSSO servidor no Vercel: sem esta
 * régua, "sobe essa imagem" vira porta pra ler serviço interno ou o metadata
 * da cloud (169.254.169.254).
 *
 * Três furos que o `fetch` com `redirect: "follow"` deixava abertos:
 *   - o 3xx pra host privado: o fetch já tinha batido no destino quando o
 *     `res.url` era conferido. Aqui cada salto é conferido ANTES do pedido.
 *   - o nome público que resolve pra IP privado (127.0.0.1.nip.io): a régua de
 *     texto não vê. Aqui a conferência é no `lookup` do socket, sobre TODOS os
 *     endereços que o DNS devolve.
 *   - o DNS que troca de resposta entre a conferência e a conexão (rebinding):
 *     conferir num lookup e conectar noutro deixa a janela. Aqui o endereço
 *     conferido é o mesmo em que o socket conecta.
 */

const MAX_REDIRECTS = 3;

// [rede, prefixo]. Tudo que não é internet pública: loopback, RFC 1918,
// link-local, CGNAT, documentação, benchmark, multicast e reservado.
const IPV4_FORA: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3], // multicast + reservado + broadcast (224/4 e 240/4)
];

const IPV6_FORA: Array<[string, number]> = [
  ["::", 128], // não especificado
  ["::1", 128], // loopback
  ["100::", 64], // descarte
  ["2001:db8::", 32], // documentação
  ["fc00::", 7], // ULA (a "rede privada" do IPv6)
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (obsoleto, ainda roteia em rede velha)
  ["ff00::", 8], // multicast
];

function ipv4Num(ip: string): number {
  return ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
}

/** Os 16 bytes de um IPv6 válido (cauda IPv4 pontuada inclusa). */
function ipv6Bytes(ip: string): number[] {
  let s = ip.toLowerCase().split("%")[0];
  const cauda = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (cauda) {
    const n = ipv4Num(cauda[2]);
    s = `${cauda[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [cabeca, resto] = s.split("::");
  const a = cabeca ? cabeca.split(":") : [];
  const b = resto ? resto.split(":") : [];
  const grupos = resto === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill("0"), ...b];
  return grupos.flatMap((g) => {
    const v = parseInt(g, 16);
    return [v >> 8, v & 0xff];
  });
}

function dentroIPv6(bytes: number[], rede: string, prefixo: number): boolean {
  const r = ipv6Bytes(rede);
  for (let bit = 0; bit < prefixo; bit += 8) {
    const resta = Math.min(8, prefixo - bit);
    const mascara = (0xff << (8 - resta)) & 0xff;
    if ((bytes[bit / 8] & mascara) !== (r[bit / 8] & mascara)) return false;
  }
  return true;
}

/**
 * true pra endereço que não é internet pública. IPv6 que carrega um IPv4 dentro
 * (::ffff:127.0.0.1, o NAT64 64:ff9b::/96, o compatível ::a.b.c.d) é julgado
 * pelo IPv4 que carrega. String que não é IP volta true: na dúvida, fora.
 */
export function isPrivateAddress(ip: string): boolean {
  const limpo = ip.replace(/^\[|\]$/g, "");
  if (net.isIPv4(limpo)) {
    const n = ipv4Num(limpo);
    return IPV4_FORA.some(([rede, prefixo]) => {
      const tamanho = 2 ** (32 - prefixo);
      return Math.floor(n / tamanho) === Math.floor(ipv4Num(rede) / tamanho);
    });
  }
  if (!net.isIPv6(limpo)) return true;
  const b = ipv6Bytes(limpo);
  const zeros = (de: number, ate: number) => b.slice(de, ate).every((x) => x === 0);
  const mapeado = zeros(0, 10) && b[10] === 0xff && b[11] === 0xff;
  const nat64 = b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12);
  const compativel = zeros(0, 12) && !zeros(12, 16) && !(zeros(12, 15) && b[15] === 1);
  if (mapeado || nat64 || compativel) return isPrivateAddress(b.slice(12).join("."));
  return IPV6_FORA.some(([rede, prefixo]) => dentroIPv6(b, rede, prefixo));
}

/**
 * Recusa URL que não é https pra host público, pelo TEXTO: nome reservado e IP
 * literal (que não passa por DNS, então o lookup abaixo não o veria). O nome
 * comum passa aqui e é conferido no lookup do socket.
 */
export function assertPublicHttpsUrl(raw: string | URL): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`sourceUrl não é uma URL válida: ${raw}`);
  }
  if (u.protocol !== "https:") {
    throw new Error("sourceUrl precisa ser https.");
  }
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const reservado =
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal");
  if (reservado || (net.isIP(h) && isPrivateAddress(h))) {
    throw new Error(`Host não permitido: ${u.hostname}`);
  }
  return u;
}

// O lookup do socket: resolve, recusa se QUALQUER endereço for privado e
// entrega ao socket exatamente os endereços conferidos. Com `all` (o
// autoSelectFamily do Node 20+ pede a lista) devolve a lista; sem, o primeiro.
const lookupPublico: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, enderecos) => {
    if (err) return callback(err, "");
    const privado = enderecos.find((e) => isPrivateAddress(e.address));
    if (privado || !enderecos.length) {
      const e: NodeJS.ErrnoException = new Error(
        `Host não permitido: ${hostname} resolve pra ${privado?.address ?? "nada"}`,
      );
      e.code = "EHOSTPRIVADO";
      return callback(e, "");
    }
    if (options.all) return callback(null, enderecos);
    callback(null, enderecos[0].address, enderecos[0].family);
  });
};

export interface PublicDownload {
  ok: boolean;
  status: number;
  statusText: string;
  contentType?: string;
  /** Onde o arquivo estava depois dos redirects. */
  url: URL;
  /** Vazio quando !ok. */
  bytes: Buffer;
}

/**
 * GET em URL pública com redirect seguido NA MÃO (até 3 saltos, cada Location
 * passa pela régua antes do pedido) e corpo com teto: o que passa de
 * `maxBytes` é cortado no meio do download, não depois de ocupar a memória.
 * `timeoutMs` vale pra cadeia inteira. Status não-2xx volta com ok=false pro
 * chamador dar o próprio recado.
 */
export async function fetchPublicHttps(
  raw: string | URL,
  { timeoutMs, maxBytes }: { timeoutMs: number; maxBytes: number },
): Promise<PublicDownload> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = assertPublicHttpsUrl(raw);
  for (let salto = 0; ; salto++) {
    const res = await pedir(url, signal);
    const location = res.headers.location;
    if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && location) {
      res.resume();
      if (salto >= MAX_REDIRECTS) {
        throw new Error(`Redirecionamento demais (mais de ${MAX_REDIRECTS}) a partir de ${raw}.`);
      }
      url = assertPublicHttpsUrl(new URL(location, url));
      continue;
    }
    const status = res.statusCode ?? 0;
    const base = {
      status,
      statusText: res.statusMessage ?? "",
      contentType: res.headers["content-type"]?.split(";")[0]?.trim() || undefined,
      url,
    };
    if (status < 200 || status >= 300) {
      res.resume();
      return { ...base, ok: false, bytes: Buffer.alloc(0) };
    }
    return { ...base, ok: true, bytes: await lerComTeto(res, maxBytes, signal) };
  }
}

function pedir(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      // Sem pool: socket reaproveitado não passaria de novo pelo lookup.
      agent: false,
      lookup: lookupPublico,
      signal,
      headers: { accept: "*/*", "user-agent": "sapiens-mcp" },
    });
    req.on("response", resolve);
    req.on("error", (e) => reject(signal.aborted ? erroDePrazo(url) : e));
    req.end();
  });
}

function lerComTeto(
  res: IncomingMessage,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const teto = `${Math.round(maxBytes / 1024 / 1024)} MB`;
  const declarado = Number(res.headers["content-length"]);
  if (declarado > maxBytes) {
    res.destroy();
    return Promise.reject(new Error(`Arquivo grande demais: ${(declarado / 1024 / 1024).toFixed(1)} MB (teto ${teto}).`));
  }
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    res.on("data", (parte: Buffer) => {
      total += parte.byteLength;
      if (total > maxBytes) {
        res.destroy(new Error(`Arquivo grande demais: passou de ${teto} no download.`));
        return;
      }
      partes.push(parte);
    });
    res.on("end", () => resolve(Buffer.concat(partes)));
    res.on("error", (e) => reject(signal.aborted ? erroDePrazo(null) : e));
  });
}

function erroDePrazo(url: URL | null): Error {
  return new Error(`O download passou do prazo${url ? ` (${url.host})` : ""}.`);
}
