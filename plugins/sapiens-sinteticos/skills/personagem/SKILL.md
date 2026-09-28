---
name: personagem
description: "Character design 2D estilizado no Midjourney 8.2: as cinco pranchas, os parâmetros certos, consistência entre imagens, e como a peça vira personagem reutilizável aqui. Puxe quando a pessoa falar em personagem, character sheet, anime, manhwa, OC ou prompt de Midjourney."
---

# Personagem no Midjourney (e trazer pra casa)

## O que muda no Midjourney (e quase ninguém faz)

**O veto vai no parâmetro, nunca no texto.** Escrever "no 3D rendering" dentro do prompt faz o modelo ler as palavras *3D* e *rendering* como parte da cena e desenhar justamente aquilo. O lugar do veto é `--no 3d render, octane, plastic skin`.

**Prompt curto ganha.** De 40 a 80 palavras. O Midjourney não é o Flux: prompt de 150 palavras dilui o peso de cada token e o miolo se perde. Se não coube, o conceito tem duas ideias brigando e vira dois prompts.

**Ilustração 2D é o default.** O modelo tem viés forte de render 3D e foto tratada, então personagem pedido no vazio volta parecendo cinemático de game. O que corrige é ancorar a mídia (`crisp ink line art`, `expressive cel shading`, `anime key visual`, `high-end webtoon illustration`), não empilhar adjetivo.

## Os parâmetros que importam

- `--v 8.2` explícito. É o default hoje, mas escrito o prompt dura mais que a versão.
- `--ar`: prancha larga `3:2`, grid de expressão `1:1`, key visual `4:5`.
- `--s` (stylize), 0 a 1000, default 100. Traço autoral vive entre 200 e 400; acima de 500 o modelo inventa e suja a linha.
- `--sref <url ou código>` com `--sw`: trava a ESTÉTICA entre imagens. É o que segura uma série.
- `--oref <url>` com `--ow`: trava a IDENTIDADE do personagem. **Armadilha:** no 8.x o job com `--oref` roda no motor V7 por baixo, então sai o personagem certo com o acabamento antigo. Quando o acabamento importa mais que o rosto, use `--sref` e descreva o personagem em texto.
- `--niji 7` pra anime e mangá puros (não existe Niji 8). Nunca no mesmo prompt que `--v`.
- Ordem: texto, parâmetros, `--no` por último.

## As cinco pranchas

Quando a pessoa pede variações, entregue cinco setups que mudam LAYOUT, não personagem: model sheet de corpo inteiro em fundo off-white; turnaround de três vistas; grid de 6 a 9 expressões; key visual de ação; estudo de silhueta com calls de figurino. Cinco vezes a mesma prancha com adjetivo trocado não é variação.

Diga a limitação na cara: turnaround tecnicamente coerente (mesma altura, mesma roupa, três vistas alinhadas) o Midjourney não entrega. Ele entrega a *estética* de um turnaround.

## Rodar no browser, se o cliente tiver browser

Três travas antes de tocar a tela:

1. **Você nunca digita credencial.** Sessão não logada, você para e pede pra pessoa logar. Verificação humana é dela.
2. **Cada geração queima GPU time do plano dela**, não Sinapses. Diga quantos prompts vai disparar e espere o ok.
3. **Publicar não é sua decisão.**

Depois: cole o prompt exatamente como está (prompt alterado no meio do caminho é peça que ninguém reproduz depois), espere a grade fechar, mostre o resultado, e pegue o link direto do arquivo da peça escolhida.

## Trazer o personagem pra casa

O caminho que funciona em conta comum, e é o que faz a peça continuar viva aqui:

```
sapiens_character action=create name="<nome>" gender="<...>" form="<human|humanoid|animal|creature|object|abstract>" style="<auto|realista|anime|manhwa|3d|custom>"
sapiens_character action=add_image characterId="<id>" imageUrl="<link direto da imagem>"
sapiens_character action=set_card systemPrompt="<a alma dele: quem é, como fala, o que veste>" title="<o lema, em português>" titleEn="<o mesmo lema, em inglês>"
sapiens_character action=activate
```

**Personagem da casa é ADULTO, e o servidor cobra.** 18 anos é o piso, 21 ou mais é o padrão: a alma declara a idade em número na primeira linha ("28 anos", nunca "parece mais nova que") e não escreve "criança", "adolescente", "menino", "menina" nem idade abaixo de 18, nem falando do passado dele nem de terceiros (troque por "casa de família", "os mais novos"). O `create` e o `set_card` recusam com a reescrita sugerida; não insista com a mesma frase, reescreva.

**Ativar NÃO é publicar, e publicar não é passo de fluxo.** O `activate` só tira o personagem do rascunho pra ele poder ser USADO: ele continua privado, só você vê, e dá pra gerar e iterar com ele à vontade assim. Quem coloca no Explorar, com página pública e slug, é outro gesto (`set_visibility isPublic=true`), e esse aí só acontece quando você pedir com essas palavras. Um agente operando por você nunca deve publicar por conta própria: na dúvida, deixa privado e pergunta. Ativar dispara um aviso no Discord da casa (é o alarme que te conta que alguém mexeu), publicar é que muda quem enxerga.

**O `titleEn` é o lema que a peça em movimento escreve.** O cartão de nome que fecha o Character Video desenha o nome do personagem e, embaixo, essa linha. Cartão é assinatura: precisa sair igual em toda peça, e é por isso que o lema mora na ficha em vez de nascer a cada roteiro. Personagem sem `titleEn` recebe o subtítulo que o roteiro daquele take inventou, e o próximo take vem com outro. Teto de 48 caracteres, que é o que cabe numa linha do cartão sem encolher a letra.

**O `form` é o argumento que mais muda o resultado, e o mais fácil de esquecer.** Ele diz que tipo de CORPO o personagem tem, e é dele que a ficha, as figurinhas e o vídeo tiram se descrevem rosto, cabelo e mãos ou silhueta, postura e marcação. Deixar no default quando o personagem não é gente entrega uma criatura desenhada com cara humana, e não é o modelo falhando: é o prompt pedindo pessoa. `human` é uma pessoa, `humanoid` é forma de gente com traço que não é de gente (elfo, androide, ciborgue), `animal` é bicho REAL com a anatomia da espécie dele (cachorro, corvo, capivara), `creature` é ser INVENTADO, mágico ou monstruoso, de anatomia livre (dragão, quimera, espírito sem rosto), `object` é coisa ou máquina que ganha vida, `abstract` é presença sem anatomia fixa. Animal e criatura eram a mesma gaveta e o bicho real pagava a conta: pedido como criatura, o corvo voltava com asa a mais e cara de monstro. Personagem que já existe errado conserta sem custo: `sapiens_character action=set_card characterId="<id>" form="creature"`.

**O `style` é o irmão dele, e responde a outra pergunta.** A forma diz que CORPO é esse; o traço diz em que TÉCNICA ele é feito, e as mesmas três peças leem daqui. `auto` (o default) não afirma técnica nenhuma: a peça sai no traço que as imagens de referência já têm, e é isso que você quer na maioria das vezes. `realista` é fotografia, `anime` é cel shading com contorno de tinta, `manhwa` é pintura suave de webtoon, `3d` é render com material e oclusão, e `custom` usa a linha que você escreve em `styleNote` ("aquarela sobre papel texturizado, cor lavada", até 140 caracteres). Vale escrever quando o personagem TEM técnica definida: não dá pra usar folha de desenho num personagem realista, nem folha de realismo num desenho. Conserto de quem já existe, sem custo: `sapiens_character action=set_card characterId="<id>" style="realista"`.

**Personagem que existe fora da casa tem ENDEREÇO, e o endereço mora na ficha.** Persona que roda de verdade tem conta em rede, tem Fanvue, tem um email que responde, e isso não é enfeite de cadastro: é o que separa uma ficha de um ser que a pessoa consegue seguir. Uma chamada, de graça, e é MERGE (mandar uma rede não apaga as outras):

```
sapiens_character action=set_presence characterId="<id>" socials='{"instagram":"helenailith","fanvue":"helen"}' websiteUrl="helenai.wtf" email="helen@casa.com"
```

Redes aceitas: instagram, tiktok, youtube, x, threads, bluesky, twitch, spotify, fanvue, patreon, onlyfans, telegram. Manda só o handle (o link inteiro colado também passa, o servidor corta). O email é o que responde POR ELE, não o seu. Pra apagar uma rede, manda ela vazia: `socials='{"instagram":""}'`. O que já está escrito volta em `action=get`, em duas formas: `presence` é o handle cru (o que se reedita) e `presenceLinks` é o link já montado (o que se mostra). A página pública do personagem desenha isso embaixo do nome.

A partir daí ele é personagem reutilizável: entra como referência nas gerações daqui (`referenceImageUrls` em `sapiens_image`), rende ficha oficial desenhada no traço dele (`generate_sheet`) e aparece no perfil. Personagem que fica solto na galeria vira imagem bonita e some.

**As placas são a referência de ÂNGULO.** Referência trava a posição da câmera: com foto de frente, o motor devolve rosto de frente por mais que o texto peça perfil. `sapiens_character action=generate_plates characterId="<id>"` gera seis ângulos do mesmo rosto numa geração só (perfil, camera-alta, camera-baixa, frontal, cabeca-baixa, outro-lado), cada um com uma expressão, e grava as seis no personagem com o papel de cada uma. Elas voltam em `action=get` no campo `plates` e NÃO entram em `imageUrls`: quando a cena pede perfil, passe a placa de perfil em `referenceImageUrls`; no resto, as fotos de sempre. Só pra personagem com rosto de gente (form human ou humanoid), e cada lote substitui o anterior.

Duas notas honestas: a imagem adicionada por link continua morando no servidor de onde veio, então quem quiser os bytes guardados aqui gera uma peça a partir dela; e trazer arquivo de fora direto pra galeria (`sapiens_gallery` upload/ingest) é porta de admin hoje, então em conta comum isso recusa e o caminho é o de cima.

## Fronteira

- Gerar dentro da casa: `sapiens_image`, com a régua da skill `imagem`. O prompt daqui roda lá sem os parâmetros (o `--ar` vira `aspectRatio`, o resto sai).
- Personagem virando vídeo: veja a skill `video`.
- Foto realista em vez de ilustração: outro território, outro vocabulário (lente, sensor, grão).
