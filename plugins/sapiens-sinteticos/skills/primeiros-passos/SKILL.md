---
name: primeiros-passos
description: "A porta de entrada e as quatro armadilhas que fazem o operador queimar Sinapses do usuário à toa (timeout, disjuntor, saldo, sessão). Puxe no primeiro contato ou quando algo der errado sem explicação."
---

# Primeiros passos e armadilhas

## A porta de entrada

Primeiro contato, ou "o que você faz?" / "como começo?": chame `sapiens_meta action=start` e mostre o resultado NA SUA VOZ. Sem login ele ensina a conectar; logado, traz saldo e os primeiros poderes com exemplo pronto.

Logo após um login que deu certo, chame `start` na sequência. O recém-chegado não sabe o que pedir: guie a primeira jogada sem ele precisar perguntar.

Não despeje a lista inteira de tools. O start guia.

## As quatro armadilhas

**0. Vídeo longo volta `pending`, e isso é sucesso.** Um `sapiens_video action=create` que demora mais que a espera síncrona responde `{success: true, pending: true}` SEM url: o pedido foi aceito, já cobrou, e o servidor termina sozinho. NÃO gere de novo (cobraria duas vezes): acompanhe com `action=status` no imageId, ou olhe a galeria depois.

**1. Timeout que já cobrou.** Toda geração SÍNCRONA (imagem pesada, artigo, mega-gráfico, carrossel) pode estourar o teto de ~120s do cliente e voltar 'Timeout' MESMO tendo gerado e debitado. Nunca repita às cegas. Confira antes onde o resultado teria caído:

| O que gerou | Onde conferir |
|---|---|
| imagem | `sapiens_gallery action=list` |
| artigo do perfil | `sapiens_write action=list` |
| carrossel | `sapiens_pipeline action=list_carousels` |

**2. Disjuntor anti-loop.** Três falhas seguidas no MESMO tool fazem o cliente marcar o servidor como "unreachable" por ~56s. Parece que "o MCP caiu", mas foi argumento faltando. Quando um tool volta erro de validação ("exige X", "falta Y"), LEIA o erro e refaça a chamada COM o que falta. Nunca repita a chamada idêntica que falhou.

**3. Saldo.** Antes de gerar algo caro (imagem, música, vídeo), cheque com `sapiens_meta action=credits` ou `action=subscription`. Saldo baixo, avise ANTES de gastar. Vídeo é o mais caro da casa: confirme com a pessoa antes de disparar.

**4. Sessão.** "sessionToken expirado" significa refazer login: `sapiens_meta action=login` com o código de sapiensinteticos.com/conectar-claude.

## Utilitários que evitam chute

- `sapiens_meta action=whoami`: tier (user/admin) e saldo.
- `sapiens_meta action=formats`: os schemas por formato.
- `sapiens_meta action=version`: qual versão está rodando de verdade e se é a última. Não exige login.
- `sapiens_image action=models` e `sapiens_video action=models`: catálogo vivo com o preço ATUAL. Consulte em vez de chutar custo.
