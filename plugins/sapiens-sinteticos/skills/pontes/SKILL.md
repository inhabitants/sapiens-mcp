---
name: pontes
description: "A pessoa tem crédito na Kie, na fal, na Magnific, na Sogni ou na própria placa e quer usar o personagem dela lá, quer gerar com a chave dela em vez de Sinapse, ou está sem Sinapse pra vídeo. Como levar a ficha, gerar no balcão dela (no MCP instalado, fal e Kie saem pela sapiens_pontes; a chave nunca passa pelo Sapiens) e a peça voltar pro acervo com a ficha inteira. Puxe quando ouvir 'gera com a minha chave', 'tenho FAL_KEY', 'tem Kie aí?', 'uso a fal', 'gastei minhas Sinapses', 'gero na Magnific', 'tenho ComfyUI'."
---

# Pontes: gerar com a sua chave e trazer pro acervo

## O que é uma ponte

O Sapiens é uma das pontes, não um muro. A pessoa monta o personagem aqui (ficha, passaporte, referências) e gera a peça ONDE TEM CRÉDITO: Kie, fal, Magnific, Sogni, Krea, Replicate, a própria placa. A peça volta pro acervo dela como NATIVA, com motor, prompt, custo real e personagem na ficha, custo 0 em Sinapses. O portfólio dela cresce aqui; o dinheiro dela sai de onde ela já pôs.

São duas portas lado a lado, e nenhuma é a reserva da outra: Sinapse (sapiens_image, sapiens_video) é pra quem não quer configurar nada; a chave própria é pra quem já tem crédito num provedor, e aí a casa não cobra nada em cima: ela paga o preço do provedor, sem margem nossa. Quando a pessoa tem chave configurada, ofereça as duas.

**A regra da chave, sem exceção:** a chave do provedor NUNCA passa pelo Sapiens. Não vai em arg de tool, não vai em prompt, não vai colada no chat. Ela mora na máquina da pessoa (o campo do plugin do Claude Code ou da extensão do Claude Desktop, ou o env do config do cliente MCP com `FAL_KEY`, `KIE_API_KEY`; um conector MCP do provedor ligado na conversa; o SDK dela) e quem chama o motor é um processo DA MÁQUINA DELA: o `sapiens-mcp` instalado (sapiens_pontes) ou o harness dela. O Sapiens entra ANTES (a ficha) e DEPOIS (o ingest). Se a pessoa colar a chave no chat por engano, diga pra ela gerar uma chave nova no provedor e pôr a nova no lugar dela (o `comoConfigurar` da `sapiens_pontes action=balcoes` diz onde), e siga sem usar o valor.

## Passo 1: descobrir onde a pessoa tem crédito

`sapiens_meta action=pontes` (sem login, sem custo) devolve o catálogo de balcões e, no MCP instalado, o que já está configurado no ambiente dela, lido pelo NOME da variável (o valor nunca é lido nem devolvido). No remoto (claude.ai, ChatGPT) ele não olha nada: pergunte.

Ordem de preferência quando há mais de uma opção, pelo que custa DE VERDADE pra pessoa:
1. O que ela já paga fixo (assinatura Sogni, Magnific com crédito parado, a própria placa): custo marginal zero.
2. O balcão onde ela tem crédito pré-pago (Kie, fal, WaveSpeed, Krea, Replicate): custo por peça, em dólar.
3. `sapiens_video` / `sapiens_image` em Sinapse: o único que serve motor exclusivo da casa e o único com a régua de qualidade da casa por trás. Não é o último por ser pior: é o último por ser o mais caro por peça.

Confirme com ela ANTES de disparar em qualquer balcão pago. Geração de fora também custa dinheiro real, só que dela.

## Passo 2: a ficha portátil

`sapiens_character action=get characterId=<id>` (ou `list_mine` pra achar o id). O que viaja:

- `passportPrompt`: o bloco já montado pra colar no prompt do motor (descritor em inglês + negative travado + locks). Cole VERBATIM no começo do prompt; a cena vem depois.
- `imageUrls` e `mainImageUrl`: as referências. São URLs públicas do CDN da casa, aceitas direto pelos motores que recebem referência por URL (Kie, fal, Krea). Motor que quer arquivo (ComfyUI, alguns SDKs): baixe a imagem antes.
- `passport.recipes`: as receitas medidas por tipo de peça (`kind`, `engine`, `prompt`, `note`). Se existe receita pro motor que ela vai usar, é ELA que vai, verbatim.
- `passport.refs` por papel (rosto, proporção, tatuagem): ref sem papel ninguém sabe usar. Use a de rosto como referência de identidade, a de proporção como frame inicial quando o motor é image-to-video.

Regras que valem fora igual dentro: prompt SEM idade em número; personagem nunca menor (a casa trabalha com 23+ no foco e 18 é piso absoluto); motor citado pelo nome que ele tem no provedor. Prompt novo que funcionar lá fora: grave de volta com `sapiens_character action=set_passport` (campo `recipes`, prompt verbatim + note com o que provou). É isso que faz a próxima rodada não redescobrir.

## Passo 3a: gerar pela porta local (fal e Kie, MCP instalado)

Com o `sapiens-mcp` instalado (plugin do Claude Code, extensão do Claude Desktop ou npx) e a chave configurada, é a porta mais curta:

1. `sapiens_pontes action=balcoes` diz quais chaves estão configuradas (pelo nome, sem ler o valor). Faltando, repasse o `comoConfigurar` da mesma resposta: ele diz onde a chave entra no jeito que o Sapiens foi instalado.
2. Confirme com ela o modelo e o custo no provedor. É dinheiro dela.
3. `sapiens_pontes action=gerar` com `provedor` ('fal' ou 'kie'), `modelo` (o slug como está na página do modelo no provedor) e `input` (o corpo que a doc do modelo descreve, com o prompt DENTRO), mais `characterId` e `referenceImageIds` pra ficha. O descritor do passaporte vai no começo do prompt; o bloco NEGATIVE vai no campo `negative_prompt` quando o modelo tem um (no corpo do prompt, negação acende o que proíbe, e o piso de idade da casa recusa palavra de menor ali). As imagens da ficha vão no campo de referência do modelo (`image_url`, `image_urls`).
4. Voltou `rodando`? Chame `sapiens_pontes action=status jobId=...`, nunca `gerar` de novo: o job está gravado na máquina dela, e o pedido idêntico em 30 minutos devolve o job que existe em vez de cobrar outra vez.
5. Terminado, a peça entra sozinha no acervo, privada, custo 0 em Sinapses, com motor, prompt verbatim e custo na ficha. Mostre com `sapiens_gallery action=list`.

No remoto (claude.ai, ChatGPT) a porta local não existe, porque a chave não sobe: ali é o Passo 3b.

## Passo 3b: gerar pelo harness (os outros balcões, ou no remoto)

O que a casa MEDIU em cada balcão (o resto está na doc do provedor; não invente parâmetro):

| Balcão | Onde a chave mora | O que roda bem | Armadilha medida |
|---|---|---|---|
| **Kie** | `KIE_API_KEY` | Kling 3.0, Kling Motion, MiniMax/Hailuo, WAN; imagem também | Um endpoint pra tudo: `POST createTask` com `model` + `input`, depois `recordInfo` até estado final. HTTP 200 NÃO é sucesso: o `code` vem no corpo (422 modelo inexistente, 500 campo faltando, 401 chave). O `resultJson` é STRING com JSON dentro (`resultUrls` está lá). A URL do resultado expira em 24h e a mídia some em 14 dias: ingira no mesmo turno. Rate limit de 20 criações por 10s por conta. |
| **fal.ai** | `FAL_KEY` | Krea 2 (inclusive sem freio), Kling, WAN, Seedance, Flux | `POST https://fal.run/<endpoint>` síncrono com `Authorization: Key <FAL_KEY>`, ou a fila em `queue.fal.run` pra vídeo. O modelo vai no SLUG do endpoint, não no corpo. Entrega em `fal.media`. Slug `fal-` na casa entra como classe +18 (sai da vitrine anônima, fica no perfil). |
| **WaveSpeed** | `WAVESPEED_API_KEY` | Flux.2 Klein, Krea 2 Livre, WAN 2.2, Kling, Shot Mimic | É o balcão que a casa mais usa por trás do `sapiens_video`; o que a casa serve em Sinapse a pessoa pode rodar direto com a chave dela. Slug `wavespeed-` é classe +18 na casa. |
| **Sogni** | `SOGNI_API_KEY` (SDK `@sogni-ai/sogni-client`) | MiniMax H3 inteira, WAN 2.2 com animate, LTX 2.3 e 2.5, Krea 2 Turbo, Identity Edit | Assinatura Unlimited cobre o catálogo aberto (`billingMode: "subscription"`, custo marginal zero); Seedance e GPT Image saem em Spark comprado. UM socket por conta: um job por vez. Vídeo de 10s+ leva 20 min de parede; rode em background e espere. Matar o processo local NÃO cancela o job (cancele pela API). |
| **Magnific / Freepik** | conector MCP na conversa (sem chave) | Seedance 2.0 e 2.5 (até 30s e 1080p, mais que a casa), MiniMax H3, upscale, relight | A URL assinada do render expira no mesmo dia: ingira na hora. `multi_prompt` junto com `references` quebra no Seedance 2.0: plano único com prompt longo. A frase "preserve their identity" é recusada pelo H3 de lá: escreva "keep the same face, body proportions, outfit". |
| **Krea API** | `KREA_API_KEY` | Krea 2 Turbo/Medium/Large, MiniMax H3 Max Turbo, Seedream, Veo, Seedance | Preço fixo por geração, saldo pré-pago separado do app. Filtra NSFW e job que falha (inclusive por moderação) não cobra. Sem img2img no Krea 2 e sem LoRA de fora. |
| **A própria máquina** | nada (ComfyUI, SD local, runner) | o que a placa aguenta: LTX, Klein, Krea 2 com LoRA, H3 destilado | Custo zero em dinheiro, pago em tempo. A peça entra por `filePath`, slug `bancada-<motor>` (ex: `bancada-ltx-2.5`). Guarde o `.json` da geração ao lado do arquivo: é de lá que sai o prompt verbatim e a seed pra ficha. |

Não repita geração paga às cegas: se a chamada deu timeout, consulte o job no provedor antes de criar outro. Peça grande (master de 30s em 1080p) reencoda em peso de web ANTES de trazer: `ffmpeg -i in.mp4 -c:v libx264 -crf 23 -preset slow -movflags +faststart out.mp4`. Guarde o master local.

## Passo 4: trazer pra casa

Pela porta local (3a) isto já aconteceu sozinho. Pelo harness (3b), `sapiens_gallery action=ingest`, no MESMO turno do render (URL de render expira):

- A peça: `filePath` (arquivo local; só no MCP instalado, é a porta de quem gerou na máquina ou baixou antes), ou `sourceUrl` (o link do render; quem baixa é o MCP na máquina da pessoa, não o servidor), ou `base64` (imagem).
- `externalEngine`: `provedor-motor`, sempre. `kie-kling-3.0`, `fal-krea-2`, `sogni-minimax-h3`, `magnific-seedance-2.5`, `bancada-ltx-2.5`. Marca sozinha é recusada: é este campo que a ficha mostra em "Motor".
- `prompt`: o texto EXATO mandado ao motor. Não é resumo, não é título. É o que permite regerar.
- `externalCost`: na moeda de lá ("420 créditos Kie", "US$ 0,35 na fal", "0, assinatura Sogni", "0, 17 min na RTX 5060 Ti").
- `characterId` (ou `characterIds` em ordem de cena quando há mais de uma criatura) e `referenceImageIds` (as peças da casa que serviram de ref). Sem os dois a peça entra órfã: publica, mas não conta no personagem.
- `aspectRatio` e `size` como saíram do motor.
- O carimbo +18 nasce na entrada pela CLASSE do provedor, porque a peça já chega renderizada e nenhuma guarda de geração da casa alcança os bytes. Peso aberto (Sogni, Replicate, Hugging Face, fal, WaveSpeed, Civitai, a própria placa) ou provedor que a casa não conhece: a peça entra COM o carimbo, que só a curadoria tira (igual ao motor sem freio da casa). Serviço com moderação (Kie, Magnific, Freepik, faceless, Krea, Midjourney, Runway, Higgsfield): entra SEM carimbo. Nome de motor com `-spicy`, `-nsfw`, `-uncensored` carimba por classe também. `unfiltered: true` é a declaração da pessoa pra motor de nome neutro em modo livre num serviço que modera: carimba em nome dela, e ela tira depois na ficha. Carimbo é alcance, não existência: publica, fica no perfil e no link, sai da vitrine anônima. Avise a pessoa quando a peça entrar carimbada por classe: ela precisa saber que a vitrine anônima não vai mostrar.

Tetos: 12 MB imagem, 60 MB vídeo por peça; 40 peças por dia e 300 no estoque por conta. Formatos: mp4, mov, png, jpg, webp.

O que a peça vira: NATIVA, PRIVADA, publicável depois por `action=publish` (ato da pessoa, nunca seu), custo 0 em Sinapses, sem assinatura C2PA (o motor rodou fora). Idempotente: repetir a mesma `sourceUrl` (ou o mesmo arquivo) corrige a ficha em vez de duplicar. Depois de ingerir, `action=list kind=video` traz a capa e a ficha: mostre a peça, não o link solto. Não apague o arquivo local antes de ver a peça no acervo.

## Quando a ponte NÃO é o caminho

- Motor exclusivo da casa: Helen TTS, Musicator, os templates de take (`templateSlug`), Sombras, o carimbo assinado. Isso só existe em Sinapse.
- A pessoa tem Sinapse e o take é curto: `sapiens_video` é um comando só, com a régua de qualidade da casa. Menos atrito vence quando o custo cabe.
- Peça achada pronta na internet, sem direção dela: é `action=upload` (privada pra sempre), não ingest.
