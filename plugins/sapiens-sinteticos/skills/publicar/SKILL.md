---
name: publicar
description: "A peça da pessoa saindo pelas contas dela: ler o painel, escolher as redes pela sugestão, escrever a legenda em blocos, confirmar e conferir. Puxe ANTES de sapiens_publicar."
---

# Publicar nas redes da pessoa

## O que é

A pessoa liga as redes dela (TikTok, Instagram, YouTube, LinkedIn, Facebook, X, Threads, Pinterest, Bluesky, Telegram, Discord) na tela do Distribution, e daqui a peça dela sai por essas contas, com o nome dela. Só peça DELA, e só rede que ela já ligou. Conectar rede nova é sempre na tela: `/dashboard/distribution`.

A tela é uma FILA: cada peça numa rede é um cartão (rascunho, agendado, enviado, publicado, falhou, descartado), e o que você faz aqui aparece lá, e vice-versa. `sapiens_publicar action=fila` lê a fila inteira: comece por ela quando a pessoa perguntar "o que eu tenho pra postar", "o que está agendado" ou "o que saiu".

## O fluxo

1. `sapiens_publicar action=painel handle=<img_..., vid_... ou car_...>`. Volta:
   - `redes`: cada rede com `conectada`, o `conta` (@), o `copyMax` (limite de texto) e o `fit` (o que rende lá). No LinkedIn com `comoPagina: true`, o `conta` é o nome da Página da empresa onde o post sai, não um @: diga "sai na Página X". Trocar entre perfil e Página é na tela, embaixo do LinkedIn em Suas redes.
   - `peca.porRede`: onde a peça já está, uma linha por rede, com `status` (rascunho, enviado, agendado, publicado, falhou, cancelado) e `url` quando saiu.
   - `sugestao`: `sugeridas` (conectadas, na ordem do que rende, com o motivo), `fora` (as que não levam essa peça e por quê) e `valeConectar` (não ligadas onde a peça iria bem).
2. Proponha as redes pela `sugestao`, na voz da pessoa. Não repita rede onde a peça já saiu, a não ser que ela peça.
3. Escreva a legenda em BLOCOS: `text` é o corpo, `cta` a chamada, `hashtags` a lista sem #. Cada rede leva o que cabe no limite dela: onde aperta, saem primeiro as hashtags, depois a chamada, e o corpo corta em fim de frase. Rede que precisa de texto próprio (o Threads curto, o LinkedIn mais longo) vai em `legendas: {threads: "..."}`. Texto publicável segue a skill voz-da-casa só se a peça for da casa; peça da pessoa fala na voz DELA.
4. **Mostre redes, legenda e horário e espere o ok.** Publicar posta de verdade na conta dela.
5. `action=publicar` com `handle`, `redes`, os blocos e, se for agendar, `agendarPara` em ISO com fuso (mínimo 5 minutos à frente, até um ano). O retorno traz `adaptadas`: diga quais redes receberam menos do que foi escrito.
6. A casa confere sozinha o que saiu (a cada 10 minutos) e avisa a pessoa no sino, e no Telegram se ela ligou, quando o post sai ou falha. Pra saber na hora, `action=lista` e `action=conferir postId=...` mostram o que cada rede fez, com o link.

## Conta extra

Quem comprou CONTA EXTRA (€ 9,90 por mês cada, na tela do Distribution, em Suas redes) tem mais de uma conta na mesma rede. Cada conta extra é um DESTINO com a conta no id: `tiktok` é o TikTok da conta 1, `tiktok@2` o da conta 2. O `painel` traz `contasExtras`, cada uma com os destinos ligados nela, e a `sugestao` já sugere cada conta pelo nome ("TikTok · Conta 2"). Rascunho, publicar, legenda própria e Teia aceitam o destino do mesmo jeito que aceitam a rede.

Um envio sai por UMA conta. Pra a peça sair na conta 1 e na conta 2, chame `publicar` duas vezes, uma por conta. Comprar, devolver e ligar as redes de uma conta extra é sempre na tela.

## Rascunho

`action=rascunho handle rede legenda` guarda a legenda de uma rede sem mandar. Ela aparece no painel da tela quando a pessoa abrir a peça, e o envio usa ela. Legenda vazia apaga. Acima do limite da rede volta erro com o número: corte você, não deixe pra rede.

## Postar de novo

A peça que já saiu pode sair de novo: `action=rascunho` ou `action=publicar` numa rede onde ela está publicada abre um cartão novo, e o que saiu fica no rastro. Mesmo texto é repostar; pra outro ângulo, escreva um texto novo, que não repita a abertura do que já saiu (`peca.porRede` do painel traz a legenda de cada rede).

## Teia

A Teia é da pessoa: "quando sai no Instagram, entra na fila do Threads". `action=teia` lê as regras; `action=teia de=instagram para=threads mudanca=ligar` liga uma (`pausar` segura sem apagar, `apagar` tira). Quando a peça sai na rede de origem, ela nasce na fila da de destino como rascunho, com o corpo da legenda no limite de lá e as hashtags à parte, e ESPERA o clique: nada sai sozinho. Filha não tece de novo, e rede onde a peça já esteve, até descartada, fica de fora. Ligar regra é decisão dela: proponha, não ligue por conta.

## Limites

- Sem custo em Sinapses. O teto é o do plano do Distribution: publicações por ciclo, mais o limite diário de cada rede. O erro diz qual bateu.
- Imagem não vai pra TikTok nem YouTube (só vídeo).
- Música (`trk_...`) e artigo (`art_...`) saem pela CAPA, como imagem, com o link da página no fim da legenda de cada rede (o corpo encurta, o link fica inteiro): por isso nada de TikTok e YouTube. Só sai peça no ar (música publicada na Comunidade, artigo publicado) e com capa; o erro diz qual falta.
- Carrossel (`car_...`) sai INTEIRO, até 10 slides: vira carrossel no Instagram e no Threads, fio de 4 em 4 no X, as 4 primeiras no Bluesky. No LinkedIn, publicado SOZINHO (`redes=['linkedin']`), vira documento de arrastar (PDF) e o retorno traz `comoDocumento: true`; junto de outras redes, ou se o PDF não sair, leva as imagens soltas. Pra ter o documento, mande o LinkedIn numa chamada própria. O Pinterest recusa mais de 5: tire ele da lista. Carrossel que nunca foi exportado nem guardado no editor ainda não tem arquivo e volta erro dizendo isso.
- Cancelar o agendamento (`action=cancelar postId=...`, até 2 minutos antes da hora) NÃO cancela a peça: ela só perde a hora e volta pra fila daquela rede, como rascunho, com a mesma legenda. Pra trocar a hora, cancele e publique de novo com `agendarPara`; pra mandar agora, cancele e publique sem hora.
