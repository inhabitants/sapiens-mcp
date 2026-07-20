import { convexQuery, getSessionToken } from "./convexClient.js";

/**
 * Cache do TIER da sessão (admin | user | desconhecido), pro tools/list ciente
 * de tier: user comum não recebe as tools admin-only (pipeline, blog editorial,
 * coluna, shorts, instagram, aula), que são as descriptions/schemas mais
 * pesadas do handshake.
 *
 * Regras:
 *   - Desconhecido = lista CHEIA (fail-open, retrocompat: igual ao comportamento
 *     de sempre). Só filtra quando o servidor SABE que o tier é user.
 *   - O cache é alimentado de graça pelos fluxos que já buscam a subscription
 *     (meta start/login/whoami/subscription/health) e por um probe único em
 *     background no boot (não bloqueia o handshake nem o tools/list).
 *   - Esconder NÃO é bloquear: o dispatch de CallTool continua atendendo
 *     qualquer tool (quem gateia de verdade é o Convex). Cliente antigo ou
 *     conversa velha que chamar uma tool escondida segue funcionando.
 *   - SAPIENS_TIER_OVERRIDE=user|admin trava o tier (teste/debug) e desliga o
 *     probe.
 */

export type Tier = "admin" | "user" | null;

let cachedTier: Tier = null;
let listeners: Array<() => void> = [];

const OVERRIDE = process.env.SAPIENS_TIER_OVERRIDE;
if (OVERRIDE === "user" || OVERRIDE === "admin") {
  cachedTier = OVERRIDE;
}

export function getCachedTier(): Tier {
  return cachedTier;
}

/** true quando a mudança altera o que o tools/list mostra (dispara listChanged). */
function visibleListChanges(prev: Tier, next: Tier): boolean {
  const filteredPrev = prev === "user";
  const filteredNext = next === "user";
  return filteredPrev !== filteredNext;
}

export function setTierFromIsAdmin(isAdmin: boolean | null | undefined): void {
  if (OVERRIDE) return; // travado por env (teste/debug)
  const next: Tier =
    isAdmin === true ? "admin" : isAdmin === false ? "user" : null;
  const prev = cachedTier;
  cachedTier = next;
  if (visibleListChanges(prev, next)) {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        // notificação é best-effort
      }
    }
  }
}

/** index.ts registra aqui o envio do notifications/tools/list_changed. */
export function onTierVisibilityChange(fn: () => void): void {
  listeners.push(fn);
}

/**
 * Probe único no boot: se há token salvo, descobre o tier em background.
 * Nunca bloqueia (o tools/list serve o cache do momento) e nunca lança.
 * Teto próprio de 5s: é otimização, não pode segurar nada.
 */
export function probeTierInBackground(): void {
  if (OVERRIDE) return;
  let token: string;
  try {
    token = getSessionToken();
  } catch {
    return; // sem sessão: tier segue desconhecido (lista cheia)
  }
  const probe = convexQuery("mcpExtras:mcpGetMySubscription", {
    sessionToken: token,
  });
  const timeout = new Promise<never>((_, reject) => {
    const t = setTimeout(() => reject(new Error("tier probe timeout")), 5000);
    // não segura o processo vivo só pelo probe
    (t as any).unref?.();
  });
  Promise.race([probe, timeout])
    .then((sub: any) => {
      if (sub?.user) setTierFromIsAdmin(!!sub.user.isAdmin);
    })
    .catch(() => {
      // offline/expirado: segue desconhecido, lista cheia
    });
}
