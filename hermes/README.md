# Sapiens Sintéticos for Hermes

![Helen, the house Sintético, moving slabs of light with her hands](assets/banner.jpg)

Your [Sapiens Sintéticos](https://www.sapiensinteticos.com/en) account inside Hermes. Ask for an image, a song, a short video or a new character and Hermes makes it on your account, in the house's engines, and keeps it in your repertoire.

Sapiens Sintéticos is a personalized learning and prototyping lab: each member builds their own studio next to their Sintético, the AI pair that walks with them. This package brings the house skills, the rules that make the output look like the house and keep the agent from burning credit by accident.

## Install

```
hermes plugins install sapiens-sinteticos
hermes mcp add sapiens --url https://www.sapiensinteticos.com/api/mcp/mcp --auth oauth
```

The second command adds the Sapiens server and opens the Sapiens sign-in in your browser. Approve the access and Hermes keeps the token, which lasts 90 days and renews with use; if it lapses, run the command again. A portable plugin cannot declare an OAuth server yet, so this step stays separate.

No account yet? Sapiens is a members' lab: [request an invite](https://www.sapiensinteticos.com/acesso?reason=no_account).

## First run

Ask Hermes "what can Sapiens do?". The server answers with your balance and a few first moves you can copy.

## What it costs

Generation spends Sinapses, the prepaid credit of your Sapiens account. The skills tell the agent to check the balance before anything expensive and to confirm with you before a video, the most expensive thing the house makes. Reading, searching, the skills and the catalog of engines with their live prices cost nothing.

## Skills

Written in Brazilian Portuguese, the platform's language. Hermes follows them in whatever language you talk to it.

- `primeiros-passos`: Primeiros passos e armadilhas
- `voz-da-casa`: A voz da casa
- `repertorio`: Repertório: guardar obra e ferramenta no acervo
- `musica`: Música e efeito sonoro
- `video`: Vídeo: escolher modelo sem queimar Sinapses
- `imagem`: Imagem na régua da casa
- `personagem`: Personagem no Midjourney (e trazer pra casa)
- `studio`: Meu Studio
- `forum-comunidade`: Fórum, chat e mídia estruturada
- `companhia`: Modo Companhia (o Sintético veste você)
- `trilhas`: Trilhas e Desafios
- `minha-voz`: Instalar a voz do usuário neste projeto
- `minha-soul`: Instalar a soul do Sintético neste projeto
- `curriculo`: Currículo PRO
- `pontes`: Pontes: gerar com a sua chave e trazer pro acervo
- `publicar`: Publicar nas redes da pessoa
- `carrossel`: Carrossel: gerar, escrever, pôr foto e entregar
- `sapiens-api`: API da conta: texto, imagem e vídeo em código

## Disclosure

- **Network:** this package has no code. Every tool call goes from Hermes to the hosted Sapiens MCP server at `https://www.sapiensinteticos.com/api/mcp/mcp` (Streamable HTTP, OAuth 2.1 with dynamic client registration), operated by Sapiens Sintéticos.
- **Credentials:** the OAuth token is stored by Hermes. The package reads no files and stores no keys.
- **Money:** generation tools debit Sinapses from your Sapiens account. Nothing is charged outside it.
- **Posting:** publishing tools post to the members' forum and to social accounts you connected on Sapiens, only when you ask.
- **Files:** two skills, `minha-voz` and `minha-soul`, have the agent write a skill file with your Sapiens profile into the current project, only when you ask for it. No other skill writes files.
- **No shell commands, no background processes, no telemetry.**

[Privacy](https://www.sapiensinteticos.com/en/privacy) · [Other clients: Claude, Cursor, Gemini CLI](https://www.sapiensinteticos.com/en/connect-claude) · [Source](https://github.com/inhabitants/sapiens-mcp)

MIT licensed.
