# Sapiens Sintéticos para o Claude Code

English: [README.md](README.md)

A sua conta do Sapiens Sintéticos dentro do Claude Code: personagem, imagem, vídeo, música, voz, repertório e Fórum. Um install traz as skills da casa e o servidor do Sapiens, que roda no seu computador.

## Instalar

No Claude Code:

```
/plugin marketplace add inhabitants/sapiens-mcp
/plugin install sapiens-sinteticos@sapiens-sinteticos
```

Precisa do Node.js 18 ou mais novo. Pelo terminal também vai: `claude plugin marketplace add inhabitants/sapiens-mcp` e depois `claude plugin install sapiens-sinteticos@sapiens-sinteticos`.

## Sinapse ou a sua chave

Ao ativar o plugin, o Claude Code pede duas chaves opcionais, da fal e da Kie.

- Em branco: você gera em Sinapse, o crédito da casa.
- Preenchidas: você gera no seu crédito do provedor, sem margem da casa.

A chave vai pro cofre do sistema e sai do seu computador só pro provedor. Pra trocar depois: `/plugin`, aba Installed, Sapiens Sintéticos, Configure options.

## Primeira vez

Pergunte "o que o Sapiens faz?". Pra conectar a conta, gere o código em https://www.sapiensinteticos.com/conectar-claude e diga "conecta minha conta Sapiens, código XXXX-XXXX".

## Usa outro app?

| Onde você usa o Claude | O que instalar |
| --- | --- |
| Claude Code (terminal, app desktop, VS Code) | este plugin |
| Chat do Claude (web, desktop, celular) | o conector, em https://www.sapiensinteticos.com/conectar-claude |
| Chat do Claude Desktop com a sua chave | a extensão, na mesma página |
| Cursor, Gemini CLI e outros clientes MCP | `npx -y sapiens-mcp` |

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

## Dados

O servidor roda no seu computador e fala com a sua conta do Sapiens pela sessão que você autorizar. Geração com a sua chave sai do seu computador direto pra fal ou pra Kie. As skills são instruções e não mandam dado nenhum. Privacidade: https://www.sapiensinteticos.com/privacidade
