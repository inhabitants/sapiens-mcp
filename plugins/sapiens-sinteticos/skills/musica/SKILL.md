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

Pular pro lyrics ou render sem create, ou sem os campos, falha sempre. É o erro número um deste fluxo.

Depois de pronta: `action=publish` põe a faixa no Acervo da Comunidade (só admin/dono, custo 0, idempotente). A publicação já nasce com player no Fórum, veja a skill `forum`.

## Efeito sonoro é outra coisa

Efeito é CURTO. Música inteira é no Musicator, não aqui.

1. Procure pronto primeiro: `sapiens_stock_audio action=list kind=sfx`. Grátis.
2. Não achou: `action=generate` com `prompt` e `durationSeconds` (1 a 15, default 5) e `provider` ('mirelo' padrão 35 Sinapses/s mín 70, 'elevenlabs' premium 60/s mín 120). `promptInfluence` (0..1) só vale no elevenlabs.
3. É assíncrono: devolve `generationId`, acompanhe com `action=generation-status` até 'ready' (traz audioUrl) ou 'failed' (reembolsa sozinho).

## Sonorizar um clipe

Dar som a um vídeo SEU já pronto é `sapiens_video action=sonorize`, não é aqui. Veja a skill `video`.
