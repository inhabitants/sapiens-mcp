import { z } from "zod";
import { readFile } from "node:fs/promises";
import {
  convexQuery,
  convexMutation,
  getSessionToken,
  isRemoteContext,
} from "../convexClient.js";
import { need } from "../schema.js";

/**
 * sapiens_share — Share Drop pelo MCP (ADMIN-ONLY; requireMcpAdmin no Convex).
 *
 * Sobe um HTML single-file e recebe o link curto sint.fyi/s/<code>. O ponto:
 * PUBLICAR um artefato e depois RE-PUBLICAR no MESMO link quantas vezes quiser
 * (action=update com o code) — edita aqui no Claude, joga pro ar, atualiza o
 * mesmo arquivo. Espelha o painel /dashboard/admin/share-drop e o CLI
 * share-drop-sync, mas sem admin key: identidade vem do sessionToken.
 *
 * O HTML entra por `html` (string, funciona no stdio E no remoto) ou por
 * `htmlPath` (caminho local .html, SÓ no MCP instalado/stdio — no remoto não há
 * disco do usuário). Título sai do <title> do HTML se não vier explícito.
 */

// Microlink oficial da casa: sint.fyi/s/<code> faz 301 preservando o path pra
// www.sapiensinteticos.com/s/<code>, onde a rota /s/[code] serve o HTML. É o
// link curto pra compartilhar. Override por env. (NÃO usar "sapiens.app": era
// só texto ilustrativo antigo, domínio não configurado.)
const SHARE_BASE_URL =
  process.env.SHARE_DROP_BASE_URL?.replace(/\/$/, "") ||
  "https://sint.fyi";

export const shareDropSchema = z.object({
  action: z.enum(["list", "upload", "update", "delete", "settings"]),
  code: z
    .string()
    .optional()
    .describe(
      "O shortcode do link (ex: dpcprvfa). Obrigatório pra update, delete e settings.",
    ),
  html: z
    .string()
    .optional()
    .describe(
      "O HTML single-file COMPLETO (doctype + CSS/JS inline). Use pra upload/update. Funciona no stdio e no remoto.",
    ),
  htmlPath: z
    .string()
    .optional()
    .describe(
      "Caminho ABSOLUTO de um .html local pra subir (upload/update). SÓ no MCP instalado (stdio); no remoto use `html`.",
    ),
  title: z
    .string()
    .optional()
    .describe("Título mostrado no admin. Se omitido, extrai do <title> do HTML."),
  keepTitle: z
    .boolean()
    .optional()
    .describe("update: mantém o título atual do link (não atualiza pelo HTML)."),
  isActive: z
    .boolean()
    .optional()
    .describe("settings: liga/desliga o link (desligado responde 'indisponível')."),
  password: z
    .string()
    .optional()
    .describe("settings: senha pra ver o conteúdo (string vazia remove a senha)."),
  requireLogin: z
    .boolean()
    .optional()
    .describe("settings: exige conta Sapiens logada pra abrir o link."),
});

export type ShareDropArgs = z.infer<typeof shareDropSchema>;

/** Extrai o <title> do HTML (mesma regex do client/CLI). */
function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m && m[1]) {
    const cleaned = m[1].replace(/\s+/g, " ").trim();
    if (cleaned) return cleaned;
  }
  return undefined;
}

/** Resolve o HTML de `html` (string) ou `htmlPath` (arquivo local, stdio only). */
async function resolveHtml(args: ShareDropArgs): Promise<string> {
  if (typeof args.html === "string" && args.html.trim()) {
    return args.html;
  }
  if (args.htmlPath) {
    if (isRemoteContext()) {
      throw new Error(
        "htmlPath só funciona no MCP instalado (stdio). No remoto, mande o conteúdo em `html`.",
      );
    }
    return await readFile(args.htmlPath, "utf8");
  }
  throw new Error(
    "Falta o HTML: passe `html` (o conteúdo) ou `htmlPath` (caminho de um .html local).",
  );
}

/** Sobe o HTML pro storage via signed URL e devolve o storageId + tamanho. */
async function uploadBlob(
  sessionToken: string,
  html: string,
): Promise<{ storageId: string; sizeBytes: number }> {
  const uploadUrl = await convexMutation<string>(
    "mcpExtras:mcpGenerateShareUploadUrl",
    { sessionToken },
  );
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "text/html" },
    body: html,
  });
  if (!res.ok) {
    throw new Error(`Upload pro storage falhou: HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { storageId?: string };
  if (!body.storageId) throw new Error("Upload não retornou storageId.");
  return { storageId: body.storageId, sizeBytes: Buffer.byteLength(html, "utf8") };
}

export async function shareDrop(args: ShareDropArgs): Promise<any> {
  const sessionToken = getSessionToken();

  switch (args.action) {
    case "list": {
      const rows = await convexQuery<any[]>("mcpExtras:mcpListShareDrops", {
        sessionToken,
      });
      return {
        count: rows.length,
        links: rows.map((r) => ({ ...r, url: `${SHARE_BASE_URL}/s/${r.code}` })),
      };
    }

    case "upload": {
      const html = await resolveHtml(args);
      const title = args.title ?? extractTitle(html) ?? "Untitled";
      const { storageId, sizeBytes } = await uploadBlob(sessionToken, html);
      const res = await convexMutation<{ code: string; title: string }>(
        "mcpExtras:mcpCreateShareDrop",
        { sessionToken, storageId, title, sizeBytes, contentType: "text/html" },
      );
      return {
        code: res.code,
        title: res.title,
        url: `${SHARE_BASE_URL}/s/${res.code}`,
        sizeBytes,
      };
    }

    case "update": {
      const code = need(args.code, "code");
      const html = await resolveHtml(args);
      const newTitle = args.keepTitle
        ? undefined
        : args.title ?? extractTitle(html);
      const { storageId, sizeBytes } = await uploadBlob(sessionToken, html);
      const res = await convexMutation<any>("mcpExtras:mcpReplaceShareDrop", {
        sessionToken,
        code,
        newStorageId: storageId,
        sizeBytes,
        contentType: "text/html",
        newTitle,
      });
      return {
        code: res.code,
        title: res.title,
        url: `${SHARE_BASE_URL}/s/${res.code}`,
        sizeBytes: res.sizeBytes,
        updatedAt: res.updatedAt,
      };
    }

    case "delete": {
      const code = need(args.code, "code");
      return await convexMutation("mcpExtras:mcpDeleteShareDrop", {
        sessionToken,
        code,
      });
    }

    case "settings": {
      const code = need(args.code, "code");
      return await convexMutation("mcpExtras:mcpSetShareDropSettings", {
        sessionToken,
        code,
        isActive: args.isActive,
        password: args.password,
        requireLogin: args.requireLogin,
      });
    }
  }
}
