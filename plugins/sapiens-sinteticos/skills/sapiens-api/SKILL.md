---
name: sapiens-api
description: "A API da pessoa (compatível com OpenAI, saldo em dólar, separado das Sinapses) pra quando ela quer chamar os motores da casa de dentro de um script, app ou agente próprio. Puxe antes de escrever código que chama www.sapiensinteticos.com/api/v1 ou quando ela perguntar de chave, saldo da API ou cobrança de uma chamada."
---

# API da conta: texto, imagem e vídeo em código

## API ou MCP

Este connector opera a conta pela conversa. A API é outra porta: a pessoa chama os motores de texto, imagem e vídeo de dentro do código dela, no formato da OpenAI, e paga do saldo em DÓLAR da conta. As duas portas são da MESMA conta e se enxergam:

- O que a API gera entra no acervo da conta. Imagem e vídeo viram peça marcada `source: api` (ache com `sapiens_gallery` e use como qualquer peça: referência, vídeo, publicar). Música e efeito sonoro viram faixa da conta (ache com `sapiens_musicator action=list`).
- O saldo em dólar também paga peça por aqui: `sapiens_image` e `sapiens_video action=create` com `pagarCom: "dolar"` (detalhe nas skills `imagem` e `video`). Sinapse não vira dólar nem o contrário: são duas carteiras, e a pessoa escolhe de qual sai.

Use a API quando a pessoa quer automatizar fora da conversa (script, app, agente dela, lote). Pra operar a conta aqui, siga com as tools.

## Onde fica

Tudo mora em Developers, no fim do menu do site: criar e revogar chave, teto de gasto por dia de cada chave, recarga (cartão ou USDC da carteira dela) e o extrato. Se a seção API não aparece lá, ela ainda não abriu pra conta.

A chave aparece UMA vez, na criação. Peça pra ela guardar numa variável de ambiente (`SAPIENS_API_KEY`). Nunca peça a chave no chat e nunca escreva a chave em código, commit ou log.

## O manual inteiro

O manual de uso, com os campos, o vídeo e a tabela de erros, é servido pela própria API, sem chave:

```
GET https://www.sapiensinteticos.com/api/v1/skill
```

Baixe e leia ANTES de escrever o código. Num agente com pasta de skills, ele entra como `.claude/skills/sapiens-api/SKILL.md`. O manual de lá manda sobre este resumo quando os dois divergirem.

## O que vale saber já

- Base: `https://www.sapiensinteticos.com/api/v1`, com `Authorization: Bearer <chave>`. No SDK da OpenAI, só troque o `baseURL`.
- Preço: o de cada modelo está em `GET /models`; vídeo cota de graça em `POST /videos/quote`. O valor de uma chamada pode variar um pouco com a oferta da hora. O valor de cada chamada volta no header `x-sapiens-charge-usd`. Pra pôr o preço da API ao lado de outro provedor (fal.ai, WaveSpeed): `sapiens_meta action=precos`, parte `api`.
- Vídeo cota de graça antes (`POST /videos/quote`), aceita `webhook_url` pra avisar quando termina e devolve a `url` do mp4 guardado. Falha do motor volta pro saldo sozinha.
- Saldo que acabou volta 402 `insufficient_balance` com `recharge_url` no erro: o código da pessoa deve mostrar esse link (recarga no cartão ou em stablecoin) em vez de só falhar.
- Uma chamada de teste antes de qualquer lote. Nunca vídeo em laço.

## Modelos de texto de preço variável: sapiens-auto e Jev Router

Dois modelos de texto que escolhem, a cada pedido, qual modelo responde, e cobram o preço dele. Não são de uso casual: o valor de cada chamada só se sabe depois, e o código da pessoa precisa respeitar isso. O preço está em `sapiens_meta action=precos` com `midia=texto`, parte `api.texto.roteadores` (a faixa do sapiens-auto, do candidato mais barato ao mais caro), e em `GET /models`.

### sapiens-auto (no POST /chat/completions)

- `model: "sapiens-auto"` e a casa escolhe o modelo de texto da conversa: código vai pra um modelo forte em código, prova e conta pesada pro topo, conversa e pergunta curta pra um modelo leve, o resto pra um do meio.
- Cobra o preço do modelo escolhido, sem taxa a mais. O `model` da resposta diz qual atendeu, e o `x-sapiens-charge-usd` diz quanto custou. A faixa de preço (do candidato mais barato ao mais caro) está na tabela.
- A escolha vale pra conversa inteira por 2 horas: as falas seguintes ficam no mesmo modelo, mesmo que fiquem triviais. A casa reconhece a conversa pelo começo dela, sem guardar o texto.
- Cuidado: quem joga no sapiens-auto texto que não escreveu (email, página, mensagem de terceiro) deixa esse texto puxar a conversa pra faixa de topo, que custa dezenas de vezes a leve. Pra agente que lê conteúdo de fora, ponha teto de gasto por dia na API key (Developers) ou fixe o modelo.
- Quem precisa de um modelo previsível (avaliação, lote com orçamento fechado) manda o id do modelo, não o sapiens-auto.

### Jev Router (no POST /chat/completions)

- `model: "jev-router"`: o router da TypeSafe escolhe o modelo e o esforço de raciocínio de cada pedido. O `model` da resposta é o que ele escolheu.
- O preço varia com o modelo que ele escolher. Não dá pra cotar antes: leia o `x-sapiens-charge-usd` de cada chamada e, em lote, confira o gasto do dia em `GET /balance`.

## Decisão: o Laya (POST /systemone)

Um modelo de decisão responde sem gerar texto: sim ou não, uma opção entre várias ou uma nota numa escala, com a confiança de cada resposta. Serve pra triagem, moderação, filtro, roteamento e leitura de intenção, em volume e barato, antes ou no lugar de chamar um modelo de texto. O preço está em `sapiens_meta action=precos` com `midia=decidir`, parte `api.decidir`, e em `GET /models` (`type: "decision"`).

- Formato System One (o mesmo do Jev): `state` (texto ou objeto) e `questions`, cada uma `noul` (sim ou não), `choice` (uma das opções de `criteria`) ou `score` (um nível de uma escala). Modelo: `laya-multilingual`, aberto, 100+ línguas.
- Cobra só a entrada. Até 4 perguntas por chamada. Uma pergunta curta decide em cerca de meio segundo; o tempo cresce com o tamanho do `state`.
- Uma decisão por vez na máquina: com fila cheia volta 503, sem cobrar. Lote vai em sequência, nunca em paralelo, e o código trata o 503 esperando e tentando de novo.
- Sem ajuste fino, o Laya erra mais que um modelo de texto em classificação aberta, às vezes com confiança alta. Serve pra triagem barata e em volume. Antes de pôr no fluxo da pessoa, rode uma amostra do caso dela e confira as respostas.
- Quem já usa o SDK do Jev troca a URL base pela da API e o modelo por `laya-multilingual`.
