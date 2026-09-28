---
name: imagem
description: "Como escrever prompt de imagem que sai com a cara do Sapiens (full-bleed, sujeito oversized), templates travados, e multi-referência. Puxe ANTES de sapiens_image action=generate."
---

# Imagem na régua da casa

## A regra do prompt

**Full-bleed. Sujeito oversized, ocupando 70% ou mais do frame.** Sem moldura, sem margem, sem cena pequena em paisagem vasta.

Proibidos no prompt: "tarot card illustration", "intimate scale", "card-style portrait", "watercolor portrait of", "small subject in vast landscape". São os padrões que sabotam o resultado e entregam imagem genérica.

## O básico

`action=generate` com `prompt`, `model` e `aspectRatio`. `action=models` (sem custo, sem login) lista o catálogo vivo com preço atual, resolução máxima e se o modelo aceita referência.

## Escolher motor em dois passos

A lista de action=models é longa e ordenada por PREÇO, que não é a pergunta de quem vai gerar. Três campos do payload resolvem isso:

- bestFor: pra que o motor serve, num vocabulário fechado (foto, anime, texto pra palavra legível na arte, personagem pra segurar a mesma pessoa, adulto). FILTRE por aqui antes de comparar preço.
- family + variant: motores com a MESMA family são o mesmo motor em versão diferente (Flux.2 Klein tem Base, Anime, Celular e Transparência; Krea 2 tem Realism e Transparência; Gemini tem 3 Pro e 3.1 Flash; GPT Image tem 2 Low, 2 High, 2.5 Flare e 2.5 Sunburst). O retorno traz um índice families já montado.
- ousadia: nudez é NÍVEL, não motor. Quando o campo vem preenchido, a mesma escolha tem uma versão com nudez: gere com `ousadia.model` + `loraIntensity` (suave, medio, forte) pra ter nudez, e com o id da linha pra não ter. Não procure um motor "+18" ou "Nu" separado na lista: ele virou este campo.

Texto legível na arte (placa, rótulo, pôster com acento): a família GPT Image é a de referência. Dentro dela, o 2.5 acerta letra pequena e acento cobrando menos que o 2 High; o Flare é o rápido, o Sunburst segura composição densa e edição em várias voltas. O preço vivo de cada um sai em action=models.

O caminho: filtre por bestFor, escolha a família, e só então compare as variantes dela entre si. Trocar de família porque uma variante é mais barata costuma trocar o resultado inteiro; trocar de variante dentro da família troca preço e acabamento, não o motor.

## Multi-referência

Combine até 4 imagens como referência numa geração só:

- `referenceImageUrls`: sua galeria, o Acervo, personagens públicos (descubra em `sapiens_character`).
- `sourceImageIds`: ids da sua galeria.

Refs valem pros modelos robustos (nano-banana-2, gpt-image-2-low/high, gpt-image-2-5-flare/sunburst, grok-2-image*). Use `sapiens_reference` pra achar a URL certa em vez de adivinhar.

Nas Krea 2 da WaveSpeed a referência é a imagem-base (uma só), e `refStrength` diz quanto dela fica: 0.2 guarda a foto quase inteira, com o rosto; 0.45 guarda pose, roupa e fundo, e o prompt muda luz e clima; 0.65 (o default) guarda enquadramento e roupa, e rosto e cenário saem do prompt; 0.9 guarda só a proporção. A peça sai no formato da referência, não no `aspectRatio`. Pra segurar o rosto de personagem numa cena nova, o caminho é o Klein, não baixar a força.

## Templates travados

`templateSlug` aplica um super-prompt da casa: o seu `prompt` vira só a CENA (quem, que pose, que objeto-conceito) e o template embrulha estilo, fundo, enquadramento e referência de traço.

- `retrato-sapiens-v1`: retrato editorial cartoon no grid verde Sapiens, a mesma "mão" dos artigos. Sem ref própria, injeta a Helen como âncora de traço; passar `referenceImageUrls` troca quem aparece.
- `storyboard-sapiens-v1`: folha de key poses, a entrada do fluxo de vídeo.

`templateSlug` e `brandSlug` são mutuamente exclusivos.

## Cuidados

- `generate` é SÍNCRONA e cobra ao concluir. Modelo pesado (Pro, gpt-image-2-high, Grok quality, Seedream 5.0 Pro, 2K/4K) cai na regra do timeout: cheque `sapiens_gallery action=list` antes de repetir, senão cobra duas vezes. O `seedream-5-0-pro` foi medido em ~140s, ACIMA do teto de 120s do cliente, então o Timeout nele é o esperado e a imagem está lá.
- `request_generation` NÃO gera imagem: só cria a row pendente e debita, pra modelos `sapiens-video-*` antes de renderizar. Caminho legado: pra vídeo novo, `sapiens_video action=create` faz tudo num call.
- Uma imagem só vira pública (e ganha página indexável) com `sapiens_gallery action=publish`.

## Quando a pessoa quer "do jeito dela", com o personagem dela

O design system dela é quem veste a peça (`sapiens_brand`), e o personagem dela pode virar a cara fixa desse design system. Depois de plugado, ele entra em toda imagem daquela marca sem ninguém anexar referência de novo:

1. `sapiens_character action=list_mine` pra achar o personagem (ele precisa ter pelo menos uma imagem na galeria: são elas que viram as referências).
2. `sapiens_brand action=persona slug=<brand dela> character=<slug do personagem>`. Grátis, e só funciona em brand custom dela (os oficiais da casa ninguém edita).
3. `sapiens_image action=generate brandSlug=<brand dela> brandMark=persona prompt='...'`. **Sem `brandMark=persona` o personagem não aparece**: o default é só o estilo.

Tirar o personagem do brand: `action=persona character=null`. Mexeu na galeria do personagem e quer as fotos novas? Rode o passo 2 de novo.

O Studio dela é outra coisa (a página de portfólio da casa dela) e não entra na geração. Veja a skill `studio`.
