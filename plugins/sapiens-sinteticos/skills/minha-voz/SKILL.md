---
name: minha-voz
description: "Transforma o retrato do usuário no Sapiens (quem ele é, como pensa, o repertório, o que faz) numa skill local do projeto atual, pra toda conversa nesta pasta já saber quem é o dono. Puxe quando ele disser 'instala minha voz', 'meu Claude precisa me conhecer', 'personaliza esse projeto comigo'. Chamava minha-soul até 22/08/2026: soul agora é só do Sintético (ver minha-soul)."
---

# Instalar a voz do usuário neste projeto

## O que você vai fazer

Escrever a voz da pessoa como skill LOCAL do projeto onde vocês estão. Depois disso, toda conversa nesta pasta abre já sabendo quem é o dono: o gosto, o jeito de pensar, o repertório, o que ele faz. Sem MCP no meio, sem chave, sem rede.

Voz é da PESSOA. Soul é do Sintético dela (a skill é outra: minha-soul). Não confunda as duas.

## Passo a passo

1. `sapiens_profile action=voz` devolve o contrato `sapiens.voz/v1`. Não cobra Sinapse.
2. Escreva `.claude/skills/sapiens-voz/SKILL.md` na raiz do projeto atual, no molde abaixo. Pasta que não existe, você cria. Arquivo que já existe, você sobrescreve: é o retrato de hoje. (Projeto que ainda tem `.claude/skills/sapiens-soul/SKILL.md` com o retrato da pessoa, de antes do rename: apague, porque esse caminho agora é da soul do Sintético.)
3. Confirme em UMA linha: o caminho do arquivo e a data do retrato. Não despeje o JSON na conversa.

Se a pessoa não estiver dentro de um projeto (conversa sem pasta, claude.ai), diga onde o arquivo deveria morar e ofereça o conteúdo pra ela colar.

## O molde

O corpo em prosa é o que o modelo lê rápido; o JSON no fim é pra quem quiser o dado estruturado. Preencha com o que veio da voz e corte a seção que voltou vazia.

````markdown
---
name: sapiens-voz
description: Quem é o dono deste projeto (nome, @, persona cognitiva, repertório, criações públicas e studios, vindos do Sapiens Sintéticos). Puxe antes de escrever copy, escolher exemplo, nomear coisa, decidir estética ou sugerir referência.
---

# A voz de <nome ou @handle>

Retrato de <data legível do generatedAt>, contrato sapiens.voz/v1. É um instantâneo, não uma conexão viva.

## Quem é
<subject: nome, @, bio, nível, badges, link do perfil>

## Como pensa
<cognition: código, persona, e os quatro eixos com polo e confiança, em uma linha cada>

## Repertório
<repertorio: total público, gêneros e tags que mais aparecem, nota média, pessoas que ele acompanha, e as obras recentes que dizem alguma coisa sobre o gosto>

## O que faz
<creations: os tipos de peça que ele publica, as criações públicas recentes com link, e o endereço do portfólio>

## Onde joga junto
<studios: os studios públicos de que ele faz parte e o papel em cada um>

## Como usar isto
Escrevendo pra essa pessoa ou no lugar dela: puxe a referência do repertório dela antes de inventar uma. O jeito de decidir está nos eixos. Na dúvida entre duas opções, escolha a que combina com o que já está aqui.

## Dados brutos
```json
<o contrato inteiro, como veio>
```
````

## Atualizar

O retrato envelhece. Quando a pessoa pedir, rode a action de novo e sobrescreva o arquivo. Nada mais precisa mudar.

## O que nunca entra

A voz é derivada e já sai filtrada da casa: saldo, transações, e-mail, contatos, conversas e criações privadas não viajam. Não tente completar o retrato com dado de outra tool.
