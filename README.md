# sapiens-mcp

**On the official [MCP registry](https://registry.modelcontextprotocol.io) as `com.sapiensinteticos/sapiens`.**

An MCP server to operate your [Sapiens Sintéticos](https://sapiensinteticos.com) account from Claude Code, or any MCP client, in your own account. You ask in plain language ("generate an image of this", "write an essay on that") and it does the work, spending your Sinapses (the house credit) and saving to your profile.

Sapiens Sintéticos is an AI prototyping lab. This server is the exoskeleton: image, video, article, voice, music, a personal Repertório (the creative memory the rest reads from), and the community, all from a single conversation.

## Account-gated by design

You connect with a Sapiens account (Google or email), no API key, no card. Accounts and login live on the site, never here. No account yet? Create one at [sapiensinteticos.com](https://sapiensinteticos.com). Every action shows its cost before it runs, and a failed generation is refunded. The remote endpoint is fail-closed: no valid session, nothing runs.

## Connect (two ways)

**Remote (any MCP client, streamable HTTP).** Point your client at:

```
https://sapiensinteticos.com/api/mcp/mcp
```

with the header `Authorization: Bearer <sessionToken>`. Generate the token at [sapiensinteticos.com/conectar-claude](https://www.sapiensinteticos.com/conectar-claude). Identity is always the bearer, so there is no local login on the remote transport.

**Local (Claude Code, npm / stdio).**

```bash
claude mcp add sapiens -- npx -y sapiens-mcp
```

Node 18+. The backend URL is built in, nothing to configure. Then log in: open [/conectar-claude](https://www.sapiensinteticos.com/conectar-claude) while signed in, generate the code (`XXXX-XXXX`, valid for 5 minutes), and run `sapiens_meta` with `action: "login"` and `code: "XXXX-XXXX"`. The 30-day token is saved to `~/.sapiens-mcp/session.json`.

Works in Claude Code (the tested path), Gemini CLI, Cursor, Antigravity, and any MCP-speaking client. Only the way you add it changes.

## What you can ask (and the cost in Sinapses)

| What | Cost |
|---|---|
| Generate an image (to your gallery) | ~400-500 |
| Write an article in the Sapiens voice (to your profile) | 400 |
| Voice / narration (Helen TTS) | 500 |
| Song lyrics / render (Musicator) | 300 / 3000 |
| Persona art | 450 |
| Repertório, list/edit your articles, check balance | free |

The Claude side always warns the cost before spending. Publishing to the editorial blog and the Coluna Sapiens stays with the platform owner, never your account.

## Troubleshooting

- **"sessionToken expired" / "Sapiens account not connected".** The 30-day token lapsed or was never saved. Open [/conectar-claude](https://www.sapiensinteticos.com/conectar-claude) signed in, generate a fresh code, and run `sapiens_meta action=login code=XXXX-XXXX`.
- **A tool or a new capability went missing after an update.** The client runs via `npx -y sapiens-mcp` (unpinned) and may be stuck on an old cache. Check what is running with `sapiens_meta action=version` (binary version, latest on npm, and `upToDate`). If `upToDate:false`, clear the npx cache and restart the client.
- **"Invalid arguments".** The message already names the field that is missing or wrong, redo the call with what it asks. Do not repeat the same failing call (3 failures in a row make the client mark the server unreachable for about a minute, an anti-loop breaker).
- **Low balance before generating.** `sapiens_meta action=credits` (or `action=subscription` for the per-bucket detail) shows what is left before you spend on image, music, or video.

## Privacy

The server only talks to the public Sapiens backend (Convex). Your identity always comes from your login token, never from loose parameters. Each account only touches what is its own.

## The house

Sister properties from the same Borderless house:

- [sapiensinteticos.com](https://sapiensinteticos.com): the studio, and this server's home.
- [aitag.app](https://aitag.app): a curated directory of AI tools (BR and EU). The Sapiens Repertório pulls from this catalog.
- [helenai.wtf](https://helenai.wtf): Helen, the house's autonomous humanized AI brand (music, chat, comics). The style anchor of Sapiens.

---

Feito no espírito borderless. Licença MIT. Com ❤️ [/conectar-claude](https://www.sapiensinteticos.com/conectar-claude).
