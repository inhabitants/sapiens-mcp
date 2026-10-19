---
name: musica
description: "O fluxo de 4 passos do Musicator (create, lyrics, render, get) e a diferença entre música e efeito sonoro. Puxe ANTES de qualquer sapiens_musicator ou sapiens_stock_audio, pular passo sempre falha."
---

# Música e efeito sonoro

## Musicator: 4 passos, nesta ordem

1. **create**: exige `title` (>=3 chars) e `context` (>=20 chars, o tema/ângulo) e `direction` (gênero/mood). Custo 0. Devolve `trackId`.
2. **lyrics**: passe `trackId` e `context` pra gravar a letra na track (300 Sinapses). Nunca chame lyrics sem title e context.
3. **render**: passe o `trackId` pronto pra sintetizar o áudio (3000 Sinapses, assíncrono, teto de 3/min).
4. **get**: passe o `trackId` e vá polando o status até 'ready' (ou 'failed').

## Qual motor no render

`model` escolhe o motor. Sem ele, sai no Lyria 3.5.

- `pro`: Lyria 3.5, faixa inteira até 3 min. Único que lê imagem de referência.
- `clip`: Lyria 3 Clip, rascunho de 30s pra testar a ideia.
- `mureka`: Mureka 9.5, faixa inteira, aguenta letra de até 5.000 caracteres.
- `minimax`: MiniMax Music 2.6, faixa inteira até 5 min. Letra de 10 a 3.000 caracteres.
- `elevenlabs`: ElevenLabs Music, a pessoa escolhe a duração em `durationSeconds` (30, 60, 120 ou 180; sem ele, 120). Letra até 3.500 caracteres.

Todos custam o mesmo render fixo, menos o ElevenLabs, que cobra pela duração (`durationSeconds`): 30s 1300, 60s 2550, 120s 5050, 180s 7600 Sinapses. Diga o número e confirme antes de disparar o de 3 min.

Letra maior que o teto do motor é recusada ANTES de cobrar, com o tamanho na mensagem: corte a letra ou troque de motor. `negativePrompt` e `seed` só valem no Lyria.

Pular pro lyrics ou render sem create, ou sem os campos, falha sempre. É o erro número um deste fluxo.

Depois de pronta: `action=publish` põe a faixa no Acervo da Comunidade (só admin/dono, custo 0, idempotente). A publicação já nasce com player no Fórum, veja a skill `forum`.

## Efeito sonoro é outra coisa

Efeito é CURTO. Música inteira é no Musicator, não aqui.

1. Procure pronto primeiro: `sapiens_stock_audio action=list kind=sfx`. Grátis.
2. Não achou: `action=generate` com `prompt` e `durationSeconds` (1 a 15, default 5) e `provider` ('mirelo' padrão 35 Sinapses/s mín 70, 'elevenlabs' premium 60/s mín 120). `promptInfluence` (0..1) só vale no elevenlabs.
3. É assíncrono: devolve `generationId`, acompanhe com `action=generation-status` até 'ready' (traz audioUrl) ou 'failed' (reembolsa sozinho).

## Sonorizar um clipe

Dar som a um vídeo SEU já pronto é `sapiens_video action=sonorize`, não é aqui. Veja a skill `video`.
