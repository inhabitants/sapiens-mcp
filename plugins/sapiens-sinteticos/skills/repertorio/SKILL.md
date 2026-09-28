---
name: repertorio
description: "Guardar filme, série, anime, jogo, jogo de tabuleiro, livro, música, pessoa ou ferramenta de IA no Repertório. Puxe ANTES de qualquer sapiens_repertorio: a gravação é travada num fluxo de dois passos e tentar guardar direto falha sempre."
---

# Repertório: guardar obra e ferramenta no acervo

## A regra que faz este fluxo falhar

Você NÃO grava uma obra passando o título. O servidor não aceita metadado vindo de você (título, capa, ano) de propósito: é anti-fabricação. Você identifica a obra num provider, e o servidor re-resolve por id e grava o canônico.

São sempre DOIS passos. Pular o primeiro falha sempre, e é o erro número um deste fluxo.

## Guardar uma obra

1. **`action=resolve`** com `mediaType` e `query` (o título como a pessoa falou). Custo 0. Volta até 8 candidatos, cada um com `source` e `externalId`.
2. Escolha o candidato certo. Em dúvida entre dois, PERGUNTE em vez de chutar: obra errada no acervo é a pessoa quem vai ter que apagar.
3. **`action=add_item`** com o `source` e o `externalId` **exatos** daquele candidato, mais o que é pessoal: `status`, `rating` (0-10), `tags`, `note`, `containsSpoilers`, `isPublic`.

`mediaType`: movie, series, anime, game, book, music, tool, person, boardgame.
`status`: backlog (quer ver), active (vendo agora), completed (viu), paused, dropped.

Jogo de tabuleiro (e de cartas) é `boardgame`: `game` é videogame, e o provider dele não conhece tabuleiro. A busca do tabuleiro é na Wikidata e acha pelo título em inglês; o designer vem em `authors` no candidato e separa homônimos. Lançamento muito recente pode ainda não estar cadastrado: resolve vazio quer dizer que o jogo não está na base, então diga isso à pessoa.

Nunca invente um `externalId` nem reaproveite um de outra busca: id que não resolve no provider é rejeitado. A dedup é por (você, source, externalId), então repetir o mesmo par não duplica.

## Guardar uma ferramenta de IA

Outro par, mesmo espírito: **`action=search_tools`** com `query` (catálogo aberto, custo 0, sem login) e depois **`action=add_tool`** com o `toolId` do candidato. Estar no acervo já quer dizer "usei"; `favorite: true` é o eixo separado de "curto e indico".

## Ler o acervo

`action=list` e `action=search` **exigem `userId`**. Descubra uma vez com `sapiens_meta action=whoami` e reuse na conversa inteira. `action=get` pede `itemId`, que vem do list/search.

Acervo de outra pessoa você lê, mas só o que ela deixou público.

## Depois de guardar

`action=update_item` muda o que é seu (`rating`, `status`, `tags`, `note`; `rating: null` remove a nota). `action=remove_item` tira do acervo. Os dois pedem `itemId`, nunca o título.

`action=popArticles` lista os artigos publicados que usam uma obra como lente. É leitura pública, não precisa de login.
