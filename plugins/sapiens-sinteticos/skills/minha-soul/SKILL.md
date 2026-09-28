---
name: minha-soul
description: "Escreve a soul do Sintético da pessoa (a personalidade dele + o que ele aprendeu conversando com ela, o caderno do par) como skill local do projeto atual, pra ele existir aqui pelo nome, na voz dele. Puxe quando ela disser 'instala a soul do meu Sintético', 'traz a <nome> pra esse projeto', 'baixa a soul', 'quero a Helen aqui'. Pra instalar quem a PESSOA é, a skill é minha-voz."
---

# Instalar a soul do Sintético neste projeto

## O que você vai fazer

Escrever a soul do Sintético da pessoa como skill LOCAL do projeto onde vocês estão: a personalidade dele (o SOUL.md que o criador escreveu) mais o que ele aprendeu conversando com ela (o caderno do par). Depois disso, toda conversa nesta pasta pode chamar esse Sintético pelo nome, na voz dele, sabendo o que ele sabe dela. É a mesma soul que o Modo Companhia veste no terminal, só que instalada no projeto.

Soul é do SINTÉTICO. A pessoa tem voz (skill minha-voz). Não confunda as duas.

## Passo a passo

1. `sapiens_sintetico action=soul` devolve `markdown` (pronto), `filename`, `kind` e `sintetico` (nome, id). Não cobra Sinapse. Quem está em cena decide de quem é a soul: o par em Sintonia, ou o personagem de autoria que ela escolheu no Modo Companhia. Pra outro personagem dela, passe `characterId` (o id vem de `sapiens_character action=list_mine`).
2. `kind` diz o que veio. `soul` é a versão completa (personalidade + memória), que só sai pra quem CRIOU o personagem. `memoria` é só o caderno do par (personagem de outra pessoa: a alma é do criador, a memória é dela). Os dois instalam igual; o arquivo diz no topo qual dos dois é.
3. Escreva `.claude/skills/sapiens-soul/SKILL.md` na raiz do projeto atual, no molde abaixo. Pasta que não existe, você cria. Arquivo que já existe, você sobrescreve: é a soul de hoje.
4. Confirme em UMA linha: o nome do Sintético, o caminho do arquivo e quantas lições vieram. Não despeje o markdown na conversa.

Se a pessoa não estiver dentro de um projeto (conversa sem pasta, claude.ai), diga onde o arquivo deveria morar e ofereça o conteúdo pra ela colar.

## O molde

O `markdown` que a action devolve já é o corpo inteiro. Você só põe o frontmatter na frente:

````markdown
---
name: sapiens-soul
description: <Nome>, o Sintético de <nome ou @ da pessoa>: a personalidade dele e o que ele sabe sobre ela, vindos do Sapiens Sintéticos. Puxe quando ela chamar <Nome> pelo nome, pedir a opinião dele, ou quiser escrever na voz dele.
---

<o markdown inteiro, como veio>
````

## Atualizar

A soul cresce: cada conversa no site, e cada `sapiens_sintetico action=log` no terminal, deixa lição nova no caderno. Quando a pessoa pedir, rode a action de novo e sobrescreva o arquivo.

## O que nunca entra

A memória de OUTRAS pessoas com o mesmo personagem nunca sai: o caderno é por par. Saldo, transações e conversas privadas também não. Sem Sintético em cena, a action recusa e diz o caminho (firmar a Sintonia no site, ou passar characterId de um personagem dela).
