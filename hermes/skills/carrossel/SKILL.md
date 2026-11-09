---
name: carrossel
description: "O carrossel do Instagram pelo agente: o caminho de custo zero (você escreve, foto do banco da casa), gerar do brief ou de um artigo pela IA da casa, reescrever os slides direto no payload, pôr foto da galeria da pessoa, a capa IA, e onde ela baixa. Puxe ANTES de sapiens_carrossel."
---

# Carrossel: gerar, escrever, pôr foto e entregar

## O que é

Um carrossel é uma RECEITA: tema (paleta, folha e assinatura) mais slides, cada um com um layout (`templateId`) e os textos dele (`slots`). O desenho sai dessa receita no editor da pessoa, que é também onde ela baixa os arquivos. Você escreve a receita; ela abre, confere e baixa.

## O caminho de custo zero (você escreve, a casa grava)

Quem escreve o texto é VOCÊ, no plano da pessoa: a casa não gasta token, então não cobra. É o caminho padrão quando ela só quer o carrossel pronto e não pediu a IA da casa.

1. `action=create` cria o carrossel. Sem `payload` nasce vazio; com `aspect` escolhe a folha (`4:5` padrão). Grátis, teto de 20 novos por dia por conta.
2. `action=get` traz o catálogo de layouts (os `slots` e o limite de cada um, quais têm foto em `requiresImage`).
3. Escreva os slides e grave com `action=update` (payload inteiro + `baseUpdatedAt`). Puxe a skill `voz-da-casa` antes. Já sabendo o catálogo, dá pra mandar o payload direto no `create` e pular este passo.
4. `action=search_images query=<o assunto da foto> orientation=vertical` busca no banco de fotos da casa, grátis e sem login. Escolha pelo título, tags e descrição.
5. `action=set_image stockImageId=<id>` em cada slide de layout com foto. Grátis.
6. Mande a `url` do editor: ela abre, confere e baixa.

Foto que o banco não cobre: `action=generate_image` gera uma nova pra um slide. `imageModel=flux-3-klein` (FLUX 3 Image Klein) é o barato, 60 Sinapses a foto, texto puro: preço que vale SÓ no slide do carrossel, e essa foto não rende o prêmio de publicar se for publicada sozinha. `nano-banana-2` (Nano Banana 2.1, o padrão) segue o estilo do banco por referência e cobra pelo catálogo (`sapiens_image action=models`). Avise o preço e espere o sim antes.

## O fluxo com a IA da casa

1. `sapiens_carrossel action=generate` com `brief` (o tema e o ângulo, um parágrafo) OU `articleId` (artigo publicado) OU `userArticleId` (artigo dela). Custa 350 Sinapses, já com a escolha de fotos, e estorna se falhar. Devolve o `id` e a `url` do editor.
2. `action=get` traz o payload inteiro e o catálogo: os layouts com os slots de cada um, as paletas, as folhas e a assinatura. Leia antes de mexer.
3. `action=update` grava o payload INTEIRO de volta. Reescreva os textos com a voz da pessoa (puxe a skill `voz-da-casa`). Mande o `theme` inteiro e o `image` de todo slide que você não mexeu: o que faltar volta pro padrão e a foto do slide some. Mande também `baseUpdatedAt` com o `updatedAt` do get: se o carrossel mudou depois (uma foto gerada, uma edição dela no editor), o update recusa em vez de apagar isso, e aí você faz get de novo. Foto nova não entra por URL no update, só pelo passo 4.
4. Foto: `action=auto_images` (60) deixa a IA escolher do banco; `action=set_image` põe uma foto do banco (`stockImageId`, do `search_images`) ou uma peça DA PESSOA pelo ID citável (`img_…`, de `sapiens_reference` ou `sapiens_gallery`), de graça; `action=generate_image` gera uma nova pra um slide, pelo preço do motor (`imageModel`).
5. Mande a `url` do editor. É lá que ela confere, ajusta e baixa.

## A forma e o tamanho

`model` é a FORMA: `feed` (o padrão, 9 slides que abrem numa dor, mostram o mecanismo e fecham em ação), `reflexao` (tema de comportamento sustentado por uma analogia), `case` (tendência a partir de link ou manchete, fecha numa keyword) e `editorial` (a IA escolhe os layouts, 7 a 9 slides).

`aspect` é o TAMANHO: `4:5` (o padrão, a folha que o feed do Instagram mostra inteira) ou `9:16` (tela cheia). Os dois trocam depois no editor sem perder texto.

## A assinatura

O nome no topo, a marca no canto da capa e o @ do fecho saem de `theme.signature` (`label`, `handle`, `logoUrl`). Nasce da marca da pessoa, ou do nome dela quando não tem marca. Se ela pedir pra mudar, mude ali, no update. O @ é o dela no Instagram: não invente, pergunte.

## O brand da peça

O design system da pessoa veste a peça inteira: a cor (`theme.brand`), a fonte do título e do corpo (`theme.fonts`), a voz do texto e a assinatura. No `generate`, `brandSlug` escolhe um brand que não é o padrão da conta. A cor de DESTAQUE (kicker, número, palavra-chave) é a cor do brand que lê no fundo e se separa do texto; pra trocar, ponha o mesmo hex em `accent` e `kicker` no update.

Ela já tem identidade fora daqui (outro app, Figma, o kit de um cliente)? Traga com `sapiens_brand action=import`, que grava hex e fonte exatos e é grátis, e aceita o arquivo de design tokens do Figma como veio. O `generate` cria um brand novo e reinterpreta. Fonte que não é do Google Fonts (Fontshare, comprada) aparece na fonte da casa até alguém subir o arquivo dela: `sapiens_brand action=font`.

## Carrossel que vem de fora

Trazendo slides de outro editor: crie o carrossel, leia o catálogo no `get` e case cada slide de lá com um layout daqui pelo PAPEL (`role`: capa, corpo, cta), pela foto (`requiresImage`) e pelos `slots`. O texto vai nos slots, o estilo vem do brand, nunca do layout de lá. Slide sem par vira o corpo mais próximo: não force texto num slot que não cabe, corte ou divida em dois slides.

## A capa IA

`action=cover` gera uma capa 16:9 com a manchete QUEIMADA na imagem, um elemento vivo cruzando as letras, e com `carouselId` fatia em duas e põe na frente do carrossel, no lugar da capa IA anterior. Cobra pelo motor da capa (o preço sai de `sapiens_image action=models`). Confirme o custo com a pessoa antes. Animar a capa é no editor, não por aqui.

## Armadilhas

- `generate`, `auto_images` com `generateMissing` e `generate_image` são síncronas e pesadas: se voltar Timeout, confira em `action=list` antes de repetir. Pode ter gerado e cobrado.
- O carrossel vai até 15 slides. A capa IA entra com dois.
- Baixar é no editor (o arquivo sai do navegador dela). Aqui você entrega a receita pronta, não o arquivo.
