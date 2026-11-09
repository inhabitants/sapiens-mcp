---
name: studio
description: "O studio é a PÁGINA de portfólio da empresa da pessoa (obra, time, endereço público), e você funda o dela pelo chat. Puxe quando ela falar do studio dela, quiser fundar um, mostrar a casa ou montar time."
---

# Meu Studio

## O que o studio é

O studio é a **página de portfólio** da empresa da pessoa: um endereço público (`sapiensinteticos.com/studios/<slug>`) com a obra, o time e o que a casa faz. Não é uma paleta de ferramentas, não tem níveis, e **não é identidade de geração**: isso morreu.

Uma pessoa pode fazer parte de até 8 studios, fundados por ela ou não. `sapiens_studios action=mine` mostra o primário dela: nome, endereço público, marca e tamanho do time. O servidor resolve pela SESSÃO, você nunca passa id.

## Fundar

`sapiens_studios action=create name="<nome da casa>"` funda. De graça, sem Sinapse.

- **Pergunte o nome, nunca invente.** O endereço público sai dele, em kebab-case, e é o que vai no cartão de visita da pessoa.
- `description` (uma linha) é opcional e aparece embaixo do nome. `brandSlug` ancora a marca dela, se ela já tiver uma.
- Nasce **no ar**, com ela como fundadora. Studio é identidade, não tem rascunho: o endereço já vale no segundo seguinte.
- Bateu o teto de 8: o erro diz. Não insista, ela sai de um pra fundar outro.

Depois de fundar, entregue o link e pare. Vestir a página (capa, logo, sobre, seções, ordem da obra) é no modo edição da própria página, não por aqui.

## O studio NÃO entra na geração

Gerar imagem "no studio dela" não existe. Se ela pedir "na minha marca" ou "do meu jeito", o caminho é explícito e é seu:

- **marca da casa** → `sapiens_image` com `brandSlug` (veja `sapiens_brand`);
- **personagem dela** → `influencerId` (veja `sapiens_character`);
- **os dois de uma vez** → `sapiens_brand action=persona` pluga o personagem dela no design system dela, e a partir daí `brandSlug` + `brandMark=persona` já leva os dois (o passo a passo está na skill `imagem`);
- **o traço da casa** → `templateSlug`.

Pergunte qual, não adivinhe.

## O time

Gente entra por convite, e o convite exige **follow mútuo**: os dois precisam já se seguir. Personagem do próprio elenco entra sem convite, é posse. Teto de 4 pessoas por casa.

A obra da página é automática por default: a soma dos Destaques de quem está no time. Se alguém empurrar uma peça à mão, ela passa a ser curada. Tudo isso se faz na página, não por aqui.
