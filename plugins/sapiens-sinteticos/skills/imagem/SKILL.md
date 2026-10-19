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

O preço de `models` é o do 1K. Sem `size`, nano-banana-2, nano-banana-max e a família Krea 2 geram em 2K e somam o adder de 2K: passe `size: "1K"` quando o barato importar mais. O que foi debitado de verdade volta em `custoSinapses` no retorno do generate; cite esse, não o da lista.

## Escolher motor em dois passos

A lista de action=models é longa e segue a ordem da prateleira da casa, não o preço, e nenhuma das duas é a pergunta de quem vai gerar. Três campos do payload resolvem isso:

- bestFor: pra que o motor serve, num vocabulário fechado (foto, anime, texto pra palavra legível na arte, personagem pra segurar a mesma pessoa, adulto). FILTRE por aqui antes de comparar preço.
- family + variant: motores com a MESMA family são o mesmo motor em versão diferente (Flux.2 Klein tem Base, Anime, Celular e Transparência; Krea 2 tem Realism e Transparência; Gemini tem 3 Pro e Nano Banana 2.1; GPT Image tem 2 Low, 2 High, 2.5 Flare e 2.5 Sunburst). O retorno traz um índice families já montado.
- ousadia: nudez é NÍVEL, não motor. Quando o campo vem preenchido, a mesma escolha tem uma versão com nudez: gere com `ousadia.model` + `loraIntensity` (suave, medio, forte) pra ter nudez, e com o id da linha pra não ter. Não procure um motor "+18" ou "Nu" separado na lista: ele virou este campo.

Texto legível na arte (placa, rótulo, pôster com acento): a família GPT Image é a de referência. Dentro dela, o 2.5 acerta letra pequena e acento cobrando menos que o 2 High; o Flare é o rápido, o Sunburst segura composição densa e edição em várias voltas. O preço vivo de cada um sai em action=models.

O caminho: filtre por bestFor, escolha a família, e só então compare as variantes dela entre si. Trocar de família porque uma variante é mais barata costuma trocar o resultado inteiro; trocar de variante dentro da família troca preço e acabamento, não o motor.

## Multi-referência

Combine até 5 imagens como referência numa geração só:

- `referenceImageUrls`: sua galeria, o Acervo, personagens públicos (descubra em `sapiens_character`).
- `sourceImageIds`: ids da sua galeria.

Quem aceita e quantas: `supportsReferences` e `maxReferences` em `action=models`. Cada motor corta no próprio teto SEM erro (nano-banana-2 e Klein em 4, Grok em 3, Krea 2 da WaveSpeed em 1): mande as refs que importam primeiro. Use `sapiens_reference` pra achar a URL certa em vez de adivinhar.

Nas Krea 2 da WaveSpeed a referência é a imagem-base (uma só), e `refStrength` diz quanto dela fica: 0.2 guarda a foto quase inteira, com o rosto; 0.45 guarda pose, roupa e fundo, e o prompt muda luz e clima; 0.65 (o default) guarda enquadramento e roupa, e rosto e cenário saem do prompt; 0.9 guarda só a proporção. A peça sai no formato da referência, não no `aspectRatio`. Pra segurar o rosto de personagem numa cena nova, o caminho é o Klein, não baixar a força.

## Editar uma área

Pra mudar SÓ um pedaço da peça (trocar o objeto da mão, apagar uma placa, pôr um chapéu) e devolver o resto igual ao pixel: `action=generate` com `sourceImageId` (uma referência só) e `maskRegions`.

- As caixas vão em FRAÇÃO da imagem, de 0 a 1, com origem no canto SUPERIOR ESQUERDO: `{x, y, w, h}`, x e y no canto superior esquerdo da caixa. `shape: "ellipse"` (o default) marca a elipse inscrita na caixa; `"rect"` marca a caixa inteira. Até 8 caixas.
- OLHE a peça antes (`sapiens_gallery action=get`) pra estimar as coordenadas, e marque com folga: área justa corta a sombra e o reflexo do que entra.
- O `prompt` descreve só o que entra na área, nunca a cena inteira.
- Motor: o que tiver `supportsMaskEdit` em `action=models` (hoje nano-banana-2 e nano-banana-max). A peça sai na proporção e no tamanho da origem, lado maior até 2048, pelo preço da geração comum.
- Recusa sem cobrar: área vazia, área que cobre quase a imagem toda (aí é `mode=edit` comum, sem `maskRegions`), mais de uma referência, motor sem o campo.

## Fundo transparente

Peça que vai virar overlay, sticker, slide ou camada de vídeo nasce recortada: `action=generate` com `transparentBackground: true`. O próprio motor desenha só o sujeito e devolve PNG com alpha, pelo preço da geração comum, sem passar pelo Remover Fundo pago depois (que adivinha o contorno; aqui quem sabe onde o sujeito acaba é quem desenhou).

- Motor: o que tiver `supportsTransparentBackground` em `action=models` (hoje a linha GPT Image: 2 Low, 2 High, 2.5 Flare e 2.5 Sunburst). Passe o `model` junto: o default (nano-banana-2) não faz e recusa sem cobrar.
- O sujeito continua oversized, mas SEM cenário: descreva só o que fica ("a single red ceramic teapot, isolated subject, crisp edges, no shadow"). Chão, parede ou céu escritos no prompt viram fundo pintado.
- A peça sobe em PNG (não webp) e volta em `sapiens_gallery` com `transparentBackground: true`. Se o motor devolver fundo chapado, a geração falha e estorna.

## Templates travados

`templateSlug` aplica um super-prompt da casa: o seu `prompt` vira só a CENA (quem, que pose, que objeto-conceito) e o template embrulha estilo, fundo, enquadramento e referência de traço.

- `retrato-sapiens-v1`: retrato editorial cartoon no grid verde Sapiens, a mesma "mão" dos artigos. Sem ref própria, injeta a Helen como âncora de traço; passar `referenceImageUrls` troca quem aparece.
- `storyboard-sapiens-v1`: folha de key poses, a entrada do fluxo de vídeo.

`templateSlug` e `brandSlug` são mutuamente exclusivos.

## Cuidados

- `generate` é SÍNCRONA e cobra ao concluir. Modelo pesado (Pro, gpt-image-2-high, Grok quality, Seedream 5.0 Pro, 2K/4K) cai na regra do timeout: cheque `sapiens_gallery action=list` antes de repetir, senão cobra duas vezes. O `seedream-5-0-pro` foi medido em ~140s, ACIMA do teto de 120s do cliente, então o Timeout nele é o esperado e a imagem está lá.
- Uma imagem só vira pública (e ganha página indexável) com `sapiens_gallery action=publish`.

## Depois de pronta: resolução maior e sombra

Duas ações da ficha do site saem por aqui, sobre uma imagem SUA já pronta (`sourceImageId`), e a peça nova entra no acervo ao lado da original, que fica intacta:

- `action=upscale`: a mesma peça em resolução maior. Use quando a pessoa vai imprimir, recortar ou levar pra vídeo em tela grande.
- `action=sombra`: o mapa de profundidade da foto (colorido, não em cinza), pra usar como referência de pose e volume numa geração seguinte.

As duas cobram Sinapses, preço fixo igual ao da ficha. São síncronas e o upscale pode passar de 2 minutos: Timeout é o cliente desistindo, não o servidor. Olhe `sapiens_gallery action=list` antes de repetir, senão cobra duas vezes.

## De qual saldo sai

A conta tem duas carteiras: Sinapses (o App) e o saldo em dólar da API (Developers). A imagem sai de qualquer uma das duas: `pagarCom: "dolar"` cobra no saldo da API, mesmo motor e mesma peça, e o valor volta em `pagoEmDolarUsd`. Sem o campo, sai em Sinapses. Use o dólar quando a pessoa pedir ou quando ela estiver sem Sinapses e com saldo na API. Sinapse não vira dólar nem o contrário. Motor do Civitai não sai em dólar.

## Peça reprovada ensina a próxima

Quando a pessoa condena uma peça ("mudou o rosto dela", "a mão está quebrada", "não é ela"), marque NO MESMO TURNO: `sapiens_gallery action=reprovar imageId=<id> motivo='<o porquê numa frase concreta>'`. O motivo bom diz a CAUSA, não só o sintoma: "trocou o rosto: gerada só com o personagem, sem as fotos de rosto do passaporte" ensina mais que "ficou feia". A reprovada não sai mais por porta nenhuma (fila de distribuição, publicar, canal) e some das sugestões do que postar; ela fica no acervo pra ensinar. Peça condenada e não marcada volta numa leva semanas depois, porque nada nela diz que foi condenada.

Antes de gerar de novo um personagem, leia o que já deu errado com ele: `sapiens_gallery action=reprovadas characterId=<id>` devolve cada peça vetada com o prompt que a gerou e o motivo. Cada motivo vira cuidado nesta geração: a referência que faltou entra, a palavra que puxou o erro sai do prompt. O erro que se repete vira regra do personagem: grave no passaporte (`sapiens_character action=set_passport`, campo `discarded`, com o negativo junto).

## Quando a pessoa quer "do jeito dela", com o personagem dela

O design system dela é quem veste a peça (`sapiens_brand`), e o personagem dela pode virar a cara fixa desse design system. Depois de plugado, ele entra em toda imagem daquela marca sem ninguém anexar referência de novo:

1. `sapiens_character action=list_mine` pra achar o personagem (ele precisa ter pelo menos uma imagem na galeria: são elas que viram as referências).
2. `sapiens_brand action=persona slug=<brand dela> character=<slug do personagem>`. Grátis, e só funciona em brand custom dela (os oficiais da casa ninguém edita).
3. `sapiens_image action=generate brandSlug=<brand dela> brandMark=persona prompt='...'`. **Sem `brandMark=persona` o personagem não aparece**: o default é só o estilo.

Tirar o personagem do brand: `action=persona character=null`. Mexeu na galeria do personagem e quer as fotos novas? Rode o passo 2 de novo.

O Studio dela é outra coisa (a página de portfólio da casa dela) e não entra na geração. Veja a skill `studio`.
