/**
 * Por onde este processo chegou na máquina da pessoa. Muda como se atualiza e
 * onde ela põe a chave de provedor:
 *
 * - "npm" (padrão): `npx -y sapiens-mcp` no config do cliente. Versão nova =
 *   limpar o cache do npx ou pinar a versão; a chave vai no "env" do config.
 * - "mcpb": a extensão do Claude Desktop (tools/mcp-sapiens/scripts/mcpb.mjs).
 *   O manifesto dela põe SAPIENS_MCP_CANAL=mcpb no ambiente. Versão nova =
 *   baixar o arquivo de novo e abrir; a chave vai no campo da extensão.
 * - "plugin": o plugin do Claude Code (tools/mcp-sapiens/scripts/plugin.mjs).
 *   O .mcp.json dele põe SAPIENS_MCP_CANAL=plugin. Versão nova = atualizar o
 *   plugin pelo /plugin; a chave vai no "Configure options" do plugin.
 */
export type Canal = "npm" | "mcpb" | "plugin";

const CANAIS: readonly Canal[] = ["npm", "mcpb", "plugin"];
const pedido = process.env.SAPIENS_MCP_CANAL as Canal | undefined;
export const CANAL: Canal = pedido && CANAIS.includes(pedido) ? pedido : "npm";

/**
 * Endereço estável da extensão no CDN da casa. O scripts/mcpb.mjs sobe aqui a
 * cada release e purga o cache da borda; a página /conectar-claude aponta pro
 * mesmo arquivo.
 */
export const MCPB_URL = "https://sapiensinteticos.b-cdn.net/mcpb/sapiens.mcpb";

/** plugin@marketplace, do jeito que os comandos do Claude Code pedem. */
export const PLUGIN_ID = "sapiens-sinteticos@sapiens-sinteticos";

export const ENDERECO_SUAS_CHAVES = "https://www.sapiensinteticos.com/conectar-claude#suas-chaves";

/** Onde a pessoa põe ou troca a chave de cada balcão, no canal deste processo. */
export function ondeFicaAChave(): string {
  switch (CANAL) {
    case "mcpb":
      return "No Claude Desktop: Configurações, Extensões, Sapiens Sintéticos. Os campos de chave (fal, Kie, WaveSpeed, Replicate, OpenRouter) ficam ali, só os que você tem, e o que você colar fica guardado no seu computador.";
    case "plugin":
      return 'No Claude Code: /plugin, aba Installed, Sapiens Sintéticos, "Configure options". Os campos de chave (fal, Kie, WaveSpeed, Replicate, OpenRouter) ficam ali, só os que você tem, e vão pro cofre do sistema; depois, /reload-plugins.';
    default:
      return `No config do cliente MCP, no bloco do sapiens, só as que você tem: "env": { "FAL_KEY": "...", "KIE_API_KEY": "...", "WAVESPEED_API_KEY": "...", "REPLICATE_API_TOKEN": "...", "OPENROUTER_API_KEY": "..." }, e reinicie o cliente. No Claude Code o plugin põe a chave num campo, e no Claude Desktop a extensão (.mcpb), sem editar config. Passo a passo: ${ENDERECO_SUAS_CHAVES}`;
  }
}

/** Como sair de uma versão atrasada, no canal deste processo. */
export function comoAtualizar(latest: string | null): string {
  switch (CANAL) {
    case "mcpb":
      return `Baixar a extensão nova (${MCPB_URL}) e abrir o arquivo: o Claude Desktop troca a versão da extensão e as chaves já guardadas ficam.`;
    case "plugin":
      return `No Claude Code: /plugin, aba Installed, Sapiens Sintéticos, "Update now" (ou \`claude plugin update ${PLUGIN_ID}\` no terminal) e depois /reload-plugins; as chaves já guardadas ficam. Pra não ficar pra trás de novo: /plugin, aba Marketplaces, sapiens-sinteticos, "Enable auto-update".`;
    default:
      return `Pinar sapiens-mcp@${latest ?? "latest"} na config do MCP, ou limpar o cache do npx e reiniciar o cliente (restart sozinho não basta, o cache sobrevive).`;
  }
}
