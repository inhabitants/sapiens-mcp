---
name: curriculo
description: "Montar um currículo profissional com a tool sapiens_resume: a entrevista, o contrato de dados, os 4 modelos e a foto que nunca sai da máquina. Puxe quando a pessoa pedir currículo, CV ou resume."
---

# Currículo PRO

## O que é

O gerador de currículo da casa, de graça: `sapiens_resume` não fala com o backend, não exige login e não cobra Sinapse. VOCÊ é o entrevistador e o redator; a tool é a gráfica. O mesmo template do Lab /experimentos/resume-builder.

## O fluxo

1. `sapiens_resume action=schema` uma vez: volta o contrato de dados e os 4 modelos.
2. Colete o conteúdo por UMA de duas portas:
   - **Entrevista**: pergunte em blocos curtos (nome e título -> contato -> resumo -> experiências, uma por vez -> formação -> competências -> idiomas -> extras). Uma pergunta por vez, não um formulário inteiro.
   - **Texto colado**: a pessoa cola o perfil do LinkedIn ou um currículo antigo; você extrai e CONFIRMA o que entendeu antes de renderizar.
3. Monte o JSON no contrato e chame `action=render`. No MCP instalado, passe `outPath` (ex: a pasta do projeto ou o Desktop) pra salvar o .html direto, sem trafegar o HTML na conversa.
4. Entregue: o arquivo abre no navegador e vira PDF com Ctrl+P (A4, margens padrão).

## Os 4 modelos (arg theme)

- **pro** (default): duas colunas, sidebar verde-jade escura com foto, contato, chips de competências e barras de idioma; principal com timeline de experiência. O visual de consultoria.
- **executivo**: duas colunas em grafite com detalhe bronze e nome em serifa. Direção e C-level.
- **moderno**: coluna única, roxo da casa. Direto e contemporâneo.
- **minimal**: coluna única, preto no branco. Máximo respiro.

`accentColor` (hex) troca a cor de destaque de qualquer modelo.

## A foto (regra de privacidade)

A foto NUNCA vai pra banco nenhum, nem da casa nem de terceiro:

- **MCP instalado (stdio)**: `photoPath` com o caminho local; ela vira data URI embutido no HTML, sem sair da máquina.
- **Conexão remota**: path local é recusado. Use `data.photo` com URL https, ou mande a pessoa anexar a foto no Lab web, onde ela fica só no navegador.
- Sem foto, o modelo pro/executivo desenha um monograma com as iniciais. Também fica bonito.

## Regras de conteúdo

- Melhore a redação, JAMAIS invente fato: cargo, empresa, período e número são da pessoa. Bullet forte começa com `<strong>Rótulo:</strong>` (Estratégia, Redação, Resultado...).
- `lang` ('pt' | 'en') casa os títulos de seção com o idioma do conteúdo.
- Competências em grupos (3 a 5), com `accent: true` só nas que definem a pessoa.
- Idiomas com `pct` honesto (nativo ~100, fluente ~85, intermédio ~55).
- Visto/disponibilidade/mudança entram em `highlight` (o box perto do contato), não no resumo.
