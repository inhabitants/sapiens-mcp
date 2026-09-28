# Sapiens Sintéticos for Claude Code

Português: [README.pt-BR.md](README.pt-BR.md)

Your Sapiens Sintéticos account inside Claude Code: characters, images, video, music, voice, your repertoire and the forum. One install brings the house skills and the Sapiens server, which runs on your computer.

## Install

Inside Claude Code:

```
/plugin marketplace add inhabitants/sapiens-mcp
/plugin install sapiens-sinteticos@sapiens-sinteticos
```

Needs Node.js 18 or newer. From a terminal it works too: `claude plugin marketplace add inhabitants/sapiens-mcp`, then `claude plugin install sapiens-sinteticos@sapiens-sinteticos`.

## Sinapses or your own key

When you enable the plugin, Claude Code asks for two optional keys, fal and Kie.

- Blank: you generate with Sinapses, the house credit.
- Filled in: you generate on your own provider credit, with no house margin.

Keys go to your system's secure credential store and leave your computer only to reach the provider. To change them later: `/plugin`, Installed tab, Sapiens Sintéticos, Configure options.

## First run

Ask Claude "what can Sapiens do?". To connect your account, generate a code at https://www.sapiensinteticos.com/conectar-claude and tell Claude "connect my Sapiens account, code XXXX-XXXX".

## Using another app?

| Where you use Claude | What to install |
| --- | --- |
| Claude Code (terminal, desktop app, VS Code) | this plugin |
| Claude chat (web, desktop, mobile) | the connector at https://www.sapiensinteticos.com/conectar-claude |
| Claude Desktop chat with your own key | the desktop extension, same page |
| Cursor, Gemini CLI and other MCP clients | `npx -y sapiens-mcp` |

## Skills

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

## Data

The server runs on your computer and reaches your Sapiens account with the session you authorize. Generations with your key go from your computer straight to fal or Kie. Skills are instructions and send nothing. Privacy: https://www.sapiensinteticos.com/privacidade
