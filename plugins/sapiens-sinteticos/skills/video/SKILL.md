---
name: video
description: "Qual modelo de vídeo usar, como iterar barato, referências e storyboard, sonorizar, e o que são os Vídeos Programáticos. Puxe ANTES de sapiens_video, vídeo é a operação mais cara da casa."
---

# Vídeo: escolher modelo sem queimar Sinapses

## Antes de tudo

`action=create` EXIGE `model`. Sem model, falha de cara. Vídeo é o mais caro: confirme com a pessoa antes de disparar.

`action=models` (sem custo, sem login) lista os modelos ativos com durações, resoluções, disponibilidade e a FAIXA de preço: o padrão, o piso e o teto, cada um dizendo em qual configuração acontece. Motor de preço-por-segundo não tem "um preço": o mesmo modelo custa 3x mais em 1080p e 30s do que em 720p e 5s.

Dois campos do payload evitam garimpo na lista. bestFor diz pra que o motor serve (audio = som nativo, fala = lip-sync, referencia = aceita referência de quem aparece, movimento = precisa de vídeo-guia, longo = passa dos 15s): filtre por aqui antes de comparar preço. family + variant dizem quem é o mesmo motor em geração ou tier diferente: as seis linhas de Seedance (1.0 Fast, 1.5 Pro, 2.0, 2.0 Fast, 2.0 Mini, 2.5) são UM motor, não seis. Escolha a família pelo trabalho, depois a variante pela conta.

`action=price` (sem custo, sem login) cota a configuração EXATA antes de rodar: passe `model`, `durationSec`, `resolution` e `audio` e receba o número que vai ser debitado, calculado pela mesma função que cobra. Ela também avisa quando o motor não aceita o que você pediu e vai cobrar outra coisa (`clamped`), o que acontece quando a duração não existe no enum ou a resolução cai num tier diferente.

Use `price` sempre que a pessoa perguntar quanto custa, e ANTES de qualquer `create` que não seja o default. Dizer o piso como se fosse o preço final é o jeito mais rápido de queimar a confiança dela: a cobrança vem maior e a culpa é sua.

## Iterar barato, fechar caro

Os três Seedance 2.0 têm o MESMO repertório (referência, frame inicial e final, vídeo de movimento, áudio nativo):

| Modelo | Custo | Teto |
|---|---|---|
| `sapiens-video-seedance-2-mini` | metade do padrão | 720p |
| `sapiens-video-seedance-2-fast` | 20% menos | 720p |
| `sapiens-video-seedance` | padrão | 1080p |

Itere enquadramento e prompt no Mini, feche no padrão quando o take estiver certo. Economiza Sinapses da pessoa sem trocar de fluxo. Pedir 1080p nos dois de cima entrega e cobra 720p.

## Quando o take precisa ser longo

`sapiens-video-seedance-25` (Seedance 2.5) é a geração seguinte, não um quarto tier da 2.0. O que ela abre: take de 4 a **30s** num fôlego (a linha 2.0 para em 15s), edição e extensão de vídeo, e áudio como referência além de imagem e vídeo. O que ela cobra por isso: ~1,5x o preço por segundo do padrão, e teto de 720p.

Duração é o que pesa aqui, não o modelo: um take de 30s em 720p passa de 40 mil Sinapses. Cheque o saldo e confirme a duração com a pessoa ANTES de disparar. Precisa de 1080p? É `sapiens-video-seedance` mesmo, a 2.5 não substitui o padrão.

## Os outros modelos

- `sapiens-video-h3`: MiniMax H3, o mais barato por pixel da casa, com som nativo, texto ou imagem. 5 a 15s em `2k` ou `768p` (o 2K longo demora uns 9 minutos: volta `pending` e termina sozinho). Aceita até 9 imagens e 3 vídeos de referência, e é o caminho de take LONGO com personagem travada. Referência e frame inicial não vão juntos: escolha um. Sem `resolution` cai no 2k, que custa 33% mais por segundo.
- `sapiens-video-h3-spicy` e `sapiens-video-seedance-spicy`: os mesmos motores SEM freio de conteúdo. Os dois partem de uma IMAGEM sua (não fazem texto puro), e é isso que trava a identidade: quem aparece já veio pronto na imagem, o motor só dá movimento. O H3 Spicy é o mais barato e o mais rápido da casa (250 Sinapses o segundo em 480p, 3 a 15s); o Seedance Spicy tem o peso do 2.0, vai a 15s em 480p e 720p e para em 10s no 1080p.
- `sapiens-video-kling`: Kling 3.0 Pro, anima imagem, 3 a 15s, som opcional.
- `sapiens-video-wan`: WAN 2.5, imagem que fala ou canta, com lip-sync, 5 ou 10s.
- `sapiens-video-wan-3`: WAN 3.0, texto ou imagem, som nativo, frame final e 1080p, 5 a 10s.
- `sapiens-video-kling-motion`: passa o movimento de um vídeo pra uma imagem. Precisa de pessoa com tronco visível na imagem E no vídeo.
- `sapiens-video-shot-mimic`: recria o plano, a câmera e os cortes de um vídeo de referência como cena nova.
- `sapiens-video-omni-11`: Gemini Omni 1.1, texto ou imagem vira clipe de 10s 720p com áudio nativo. Aceita até 3 imagens suas (frame inicial, frame final ou referência de personagem e estilo); vídeo de referência não, e durationSec/resolution seguem ignorados. O truque: `editOfImageId` aponta um vídeo Omni seu e o prompt vira instrução de edição sobre a MESMA cena (troca item ou personagem, preserva câmera e ambiente). É o caminho pra variações com continuidade: gera a base uma vez, edita N vezes. Cada edição debita como geração nova.
- `sapiens-video-omni`: o Gemini Omni 1.0, a versão preview. Mesmo preço e mesmo repertório do 1.1, mantida só pra comparar as duas. Nasce desligada (não aparece na lista de motores), então peça o 1.1.
- `sapiens-video-lite` / `-fast` / `-quality`: Veo 3.1.

## Receita de take (`templateSlug`), quando o formato já tem forma

Formato conhecido não precisa de prompt escrito do zero. Passe `templateSlug` e a receita da casa embrulha a cena com estilo, cenário, arco, áudio e look, e ainda escolhe o motor (aí `model` fica opcional). O `prompt` vira só a CENA e o `brief` preenche o resto.

| Slug | O take |
|---|---|
| `ugc-vertical-v1` | selfie que fala, o formato nativo de Reels, TikTok e Shorts |
| `unboxing-vertical-v1` | mãos e reveal, som real de papel e lacre |
| `app-demo-vertical-v1` | a tela do app legível na mão da pessoa |
| `reflexao-vertical-v1` | talking-head lento pra ideia ou ensaio |

O `brief` aceita `subject`, `persona`, `hook` (`line` e `emotion`), `shots` (cada um com `sec`, `camera`, `action`, `emotion`, `voiceLine`, `propVisible`), `uvps`, `language` e `energy`. Campo vazio SOME do prompt em vez de virar buraco, e o que você não passa cai no valor de reserva da receita.

`action=templates` (sem custo, sem login) lista o catálogo vivo: spec default, o que dá pra sobrepor e os `briefFields` que cada receita realmente usa. Override fora da whitelist é recusado com as opções na mensagem.

## Fluxo storyboard (o que dá o melhor resultado)

Imagens de REFERÊNCIA via `referenceImageIds` / `referenceImageUrls` / `referenceImagePaths` guiam estilo, personagem e composição SEM virar o primeiro frame. O teto é do motor: 4 no Seedance 2.0, 9 no H3.

1. Gere a folha de key poses com `sapiens_image templateSlug='storyboard-sapiens-v1'`.
2. Passe folha e personagem como refs num text-to-video.
3. Descreva o take contínuo no prompt, citando as refs por descrição e mandando ignorar o traço do sketch.

Dá pra somar 1 vídeo de movimento via `referenceVideoUrls` (até 15s, host da casa): a coreografia e a câmera do clipe guiam o take.

Frame inicial e final: `startImageId`/`endImageId` (galeria) ou `startImageUrl`/`endImageUrl`. Arquivo local (`startImagePath`) só funciona no MCP instalado via stdio, nunca no remoto. Suporte a frame final varia por modelo.

## É assíncrono

`create` cria o row, debita e volta NA HORA com `{imageId, status:'rendering'}`. Acompanhe com `action=status imageId=<id>` até 'completed' (traz a url) ou 'error'/'blocked'.

NÃO chame create de novo enquanto renderiza: cria outro vídeo e cobra de novo. Falha de provider refunda sozinha.

## Sonorizar

`action=sonorize` com `imageId` de um vídeo SEU já completed e `prompt` descrevendo o som da cena (ambiente, materiais, impactos). Sai uma VARIANTE nova com trilha sincronizada ao movimento (MMAudio, 20 Sinapses/s do clipe, mín 100), e o original fica intacto.

Sonorize sempre o ORIGINAL, nunca uma variante. Acompanhe com `action=status` no imageId NOVO que o sonorize devolve.

## Extrair o depth map (ADMIN)

`action=shadows` com `videoUrl` (URL pública) e `title` extrai o mapa de profundidade de um vídeo: 200 Sinapses/segundo, com refund na falha. Passe `durationSec` quando souber, pra cobrar proporcional; sem ela vai no flat ~2000.

O depth map cai na SUA timeline de vídeos (quem extrai vira dono) e vira ficha no Acervo como driving reutilizável pro Shot Mimic e o Kling Motion. `action=shadows-list` lista os prontos.

## Vídeos Programáticos são outra coisa

O Lab de filmes-de-código da casa (/experimentos/films) tem cinco tipos: demo (UI clonada mais câmera), aula-tour (telas reais mais narração), essay (fita-ensaio abstrata), tipografia-musical (a música dirige o corte) e dataviz (números no tempo).

O RENDER não sai deste connector: um agente local no repo da casa produz o mp4. Mas o CICLO na plataforma fecha por aqui, sem custo: `film-list`, `film-get`, `film-upsert`, `film-status`, `film-publish`. Membro pedindo "fita-ensaio" ou "demo film": aponte pra tela e pro agente local.
