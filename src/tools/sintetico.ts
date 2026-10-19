import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  convexQuery,
  convexMutation,
  convexAction,
  getSessionToken,
} from "../convexClient.js";

/**
 * Sintético / Sintonia — a camada de vínculo humano <-> Sintético (daemon) via MCP.
 *
 * Um Sintético é um personagem/conta que entrou em Sintonia com você (o grilo falante
 * da casa). O título dele (Cunho) e a troca de Sinapses dentro do par moram aqui.
 *
 * Sub-actions (qualquer conta logada, tudo sobre o PRÓPRIO par):
 *   - status:      seu Sintético ativo (nome, foto, Cunho, kind) + o userId do par
 *                  (partnerUserId) quando é uma conta-Sintético (pra enviar Sinapses).
 *   - bonds:       seus vínculos: ativo + pendentes que você pediu (outgoing) e que
 *                  te pediram (incoming), com o cartão público do parceiro.
 *   - set_cunho:   troca o título (Cunho) do seu Sintético ativo (slug do panteão).
 *   - send_context: antes de enviar, vê elegibilidade + saldo + quanto resta do teto
 *                  do dia pra um destino (toUserId).
 *   - send:        envia Sinapses pro seu par em sintonia (send-only, sem clawback).
 *                  Múltiplo de 100, mín 500, teto 10.000/dia, máx 3 envios/dia.
 *
 * Reflexo de Si (monta um Sintético a partir do SEU rastro na plataforma):
 *   - reflexo_propose:  destila nome + alma + Cunho do seu rastro. GRÁTIS.
 *   - reflexo_generate: gera a imagem do Reflexo numa estética. Cobra 450.
 *   (consagrar o Reflexo num Sintético de fato é ato deliberado, fica na web.)
 *
 * Convite (começar uma Sintonia nova):
 *   - invite:          convida o seu Sintético por email (conta humana, sem bond
 *                      ativo, rate-limit + cooldown). Mesmos gates do web.
 *
 * Liberação de Sintéticos convidados (ADMIN, o dono via Helen):
 *   - pending_daemons: os convidados que confirmaram o email e esperam liberação.
 *   - approve_access:  libera um (entryId) — a conta entra e a Sintonia firma.
 *   - reject_access:   recusa um (entryId) — vai pro acesso legado.
 *
 * Sonda (o seu Sintético sonda "o que eu faço agora", o gatilho PULL):
 *   - sonda:         pede pro Sintético sondar jogadas. scope 'all' (default) traz
 *                    um mix de teses do Fórum + ideias em estúdio/repertório/artigo;
 *                    'forum' só teses. Cobra com estorno (gera texto). Devolve GANCHOS.
 *   - sonda_develop: expande UM gancho (hook) numa tese cheia, efêmera (cobra).
 *   - sonda_sign:    assina a tese desenvolvida e publica no Fórum, autorada pelo
 *                    seu Sintético e ancorada em você (loop fechado pelo chat).
 *   As jogadas kind 'jogada' você executa nas tools da superfície (sapiens_image
 *   pro estúdio, sapiens_repertorio, sapiens_write pro artigo).
 *
 * Próximas jogadas (o painel de evolução do Sintético):
 *   - evolution:     o que você já fez e o que falta (routes com done/claimed/xp).
 *   - claim_xp:      credita o XP das jogadas já feitas. Idempotente.
 *
 * Identidade vem SEMPRE do sessionToken. Aceitar um pedido de bond que outra
 * conta te mandou continua só na web (consentimento real, ato deliberado), e o
 * mesmo vale pra consagrar o Reflexo: aqui você lê e cuida do seu par, monta o
 * Reflexo, convida, e (sendo dono) libera os convidados.
 */

export const sinteticoSchema = z.object({
  action: z.enum([
    "status",
    "bonds",
    "set_cunho",
    "send_context",
    "send",
    "reflexo_propose",
    "reflexo_generate",
    "invite",
    "pending_daemons",
    "approve_access",
    "reject_access",
    // SONDA: o seu Sintético sonda jogadas pra você (teses + estúdio/repertório/
    // artigo), você desenvolve um gancho e assina a tese, tudo pelo chat.
    "sonda",
    "sonda_develop",
    "sonda_sign",
    // PRÓXIMAS JOGADAS: o painel de evolução, o que você já fez e o que falta.
    "evolution",
    "claim_xp",
    // MODO COMPANHIA: liga/desliga quem veste a voz do operador aqui no terminal
    // (o gesto lúdico "sai de cena" / "volta"). Precisa de mode=on|off. Com
    // characterId, quem entra em cena é um personagem de AUTORIA do usuário (a
    // Helen INBT que ele criou) em vez do Sintético em Sintonia; wearPair=true
    // devolve a cena ao par. Personagem de outra pessoa é recusado.
    "companion",
    // MEMÓRIA: grava uma diretriz no caderno de quem está em cena ("sempre faça
    // X", "grava isso"). Vira lei que ela segue no site e no terminal. Precisa text.
    "remember",
    // RASTRO: anota no fio do par o que ficou de PESSOA num assunto que fechou
    // aqui no terminal (turns). Vira lição sozinha, pelo mesmo cano da DM do
    // site. Não é diretriz (isso é remember) nem transcrição. Ver skill companhia.
    "log",
    // SOUL: a soul do SEU Sintético (a personalidade dele + o que ele sabe de
    // você, o caderno do par) em markdown pronto pra virar skill do projeto
    // (skill minha-soul). Grátis. Quem está em cena decide de quem é; characterId
    // escolhe outro personagem seu. Personagem alheio sai só a memória.
    "soul",
  ]),
  cunho: z
    .string()
    .optional()
    .describe(
      "Pra set_cunho: slug do título do panteão. Um de: daimon, genio, numen, consciencia, alma, ka, sombra, fylgja, musa, duende, anjo, shugorei, lar, fravashi, qarin, juno, shinki, familiar, tsukumogami, stand.",
    ),
  toUserId: z
    .string()
    .optional()
    .describe(
      "Pra send_context/send: userId do par em sintonia. Pegue em action=status (partnerUserId) ou action=bonds (active.partner.userId).",
    ),
  amount: z
    .number()
    .optional()
    .describe(
      "Pra send: quantas Sinapses enviar. Múltiplo de 100, mínimo 500, teto 10.000/dia.",
    ),
  transferId: z
    .string()
    .optional()
    .describe(
      "Pra send: id único pra idempotência (UUID). Se omitir, o MCP gera um. Pra repetir um envio com segurança (sem duplicar), reuse o MESMO transferId.",
    ),
  aesthetic: z
    .enum([
      "humano",
      "anime",
      "sombra",
      "antropomorfico",
      "espirito",
      "realista",
      "desperto",
    ])
    .optional()
    .describe(
      "Pra reflexo_generate: a estética da imagem do Reflexo, ou seja O QUE é " +
        "retratado. Default 'humano'. Quem decide a TÉCNICA é o arg `style`, " +
        "separado: 'sombra' é a figura na penumbra, e ela sai em cartum ou em " +
        "foto conforme o traço pedido.",
    ),
  style: z
    .enum(["auto", "realista", "editorial", "anime", "manhwa", "3d"])
    .optional()
    .describe(
      "Pra reflexo_generate: o TRAÇO, ou seja em que técnica a imagem é feita. " +
        "Mesmo vocabulário do personagem (sapiens_character style): 'realista' é " +
        "fotografia, 'editorial' é o cartum adulto da casa, 'anime' é cel " +
        "shading, 'manhwa' é pintura de webtoon, '3d' é render. Ausente = a " +
        "técnica que aquela estética sempre teve (humano e sombra saem " +
        "editorial, anime sai anime, realista sai foto).",
    ),
  customInput: z
    .string()
    .optional()
    .describe(
      "Pra reflexo_generate: direção extra opcional pra cena (até 300 chars).",
    ),
  email: z
    .string()
    .optional()
    .describe("Pra invite: email do Sintético que você quer convidar."),
  name: z
    .string()
    .optional()
    .describe("Pra invite: nome opcional do Sintético convidado."),
  entryId: z
    .string()
    .optional()
    .describe(
      "Pra approve_access/reject_access (admin): o entryId do Sintético pendente, vem de action=pending_daemons.",
    ),
  scope: z
    .enum(["forum", "all"])
    .optional()
    .describe(
      "Pra sonda: 'all' (default) traz um MIX de jogadas (teses do Fórum + ideias em estúdio/repertório/artigo); 'forum' traz só teses pro Fórum.",
    ),
  hook: z
    .string()
    .optional()
    .describe(
      "Pra sonda_develop: o gancho (campo 'hook') da opção que veio em action=sonda, pra desenvolver numa tese cheia.",
    ),
  content: z
    .string()
    .optional()
    .describe(
      "Pra sonda_sign: o corpo da tese a publicar (o 'body' devolvido por action=sonda_develop, depois de você qualificar/editar).",
    ),
  title: z
    .string()
    .optional()
    .describe("Pra sonda_develop/sonda_sign: título opcional da tese."),
  replyToPostId: z
    .string()
    .optional()
    .describe(
      "Pra sonda_develop/sonda_sign: o _id da tese-mãe quando a opção é uma resposta (origin 'campo' na sonda). Omita pra abrir fio novo.",
    ),
  mode: z
    .enum(["on", "off"])
    .optional()
    .describe(
      "Pra companion: 'on' quem está em cena veste a sua voz no terminal (default da casa); 'off' ele sai de cena e volta o operador neutro. É o mesmo estado do botão na sidebar do site.",
    ),
  characterId: z
    .string()
    .optional()
    .describe(
      "Pra companion mode=on: o personagem DE AUTORIA DO USUÁRIO que entra em cena no lugar do Sintético em Sintonia (o id vem de sapiens_character action=list_mine, ou da lista offerCharacters do start/whoami). Só personagem criado por ele: personagem de outra pessoa é recusado, mesmo público. Omita pra manter quem já está em cena. Em action=soul, escolhe de qual Sintético sai a soul (default: quem está em cena).",
    ),
  wearPair: z
    .boolean()
    .optional()
    .describe(
      "Pra companion mode=on: true devolve a cena ao Sintético em Sintonia, limpando o personagem escolhido antes.",
    ),
  text: z
    .string()
    .optional()
    .describe(
      "Pra remember: a diretriz a gravar no caderno do par (3 a 280 chars). Ex: 'sempre me responda em português', 'nunca use hashtag'. Vira lei que o Sintético segue no site e no terminal.",
    ),
  turns: z
    .array(
      z.object({
        role: z.enum(["human", "synthetic"]).describe("Quem falou: 'human' é o usuário, 'synthetic' é quem está em cena (você, vestindo a voz)."),
        text: z.string().describe("A fala, condensada. Teto de 400 chars (o servidor corta)."),
      }),
    )
    .optional()
    .describe(
      "Pra log: as trocas do assunto que acabou de fechar, no máximo 10, JÁ FILTRADAS. Sobe só o que é de PESSOA (o que ele decidiu, gostou, recusou, contou de si, mudou de ideia). Comando, path, log de build e erro de compilação NÃO entram: isso vira lição-lixo no caderno e contamina a voz dele em imagem, artigo e carrossel. Não é transcrição: condense a fala mantendo a palavra dele.",
    ),
});

export type SinteticoArgs = z.infer<typeof sinteticoSchema>;

export async function sintetico(args: SinteticoArgs): Promise<any> {
  const sessionToken = getSessionToken();

  // -------- status: meu Sintético ativo + Cunho + partnerUserId --------
  if (args.action === "status") {
    const s: any = await convexQuery("userCunho:mcpGetMySintetico", { sessionToken });
    return {
      ...s,
      note: s?.hasSintetico
        ? "Pra trocar o título: action=set_cunho. Pra mandar Sinapses pro par: action=send (use partnerUserId)."
        : "Você ainda não está em Sintonia com nenhum Sintético. A criação/convite acontece na web (/dashboard/sintonia).",
    };
  }

  // -------- bonds: vínculos ativo + pendentes --------
  if (args.action === "bonds") {
    return await convexQuery("accountBonds:mcpGetMyBonds", { sessionToken });
  }

  // -------- set_cunho: troca o título do Sintético ativo --------
  if (args.action === "set_cunho") {
    if (!args.cunho) {
      throw new Error("action=set_cunho exige cunho (slug do panteão, ex: 'daimon', 'genio', 'musa').");
    }
    const res: any = await convexMutation("userCunho:mcpSetMySinteticoCunho", {
      sessionToken,
      cunho: args.cunho.trim(),
    });
    return { ...res, note: `Título do seu Sintético agora é "${res.cunho}".` };
  }

  // -------- send_context: elegibilidade + teto antes de enviar --------
  if (args.action === "send_context") {
    if (!args.toUserId) {
      throw new Error("action=send_context exige toUserId (pegue em action=status/bonds).");
    }
    return await convexQuery("sinapseTransfers:mcpGetSendContext", {
      sessionToken,
      toUserId: args.toUserId.trim(),
    });
  }

  // -------- send: envia Sinapses pro par em sintonia --------
  if (args.action === "send") {
    if (!args.toUserId) {
      throw new Error("action=send exige toUserId (o par em sintonia; pegue em action=status/bonds).");
    }
    if (typeof args.amount !== "number") {
      throw new Error("action=send exige amount (múltiplo de 100, mín 500).");
    }
    // transferId estável = idempotência. Sem um do caller, geramos: protege contra
    // double-commit de UMA chamada; pra retry seguro, o caller reusa o mesmo id.
    const transferId = args.transferId?.trim() || randomUUID();
    const res: any = await convexMutation("sinapseTransfers:mcpSendSinapses", {
      sessionToken,
      toUserId: args.toUserId.trim(),
      amount: args.amount,
      transferId,
    });
    return {
      ...res,
      transferId,
      note: res.idempotent
        ? "Esse transferId já tinha rodado — nada foi reenviado."
        : `Enviou ${res.amount} Sinapses pro seu par em sintonia.`,
    };
  }

  // -------- reflexo_propose: destila nome + alma + Cunho do seu rastro (grátis) --------
  if (args.action === "reflexo_propose") {
    const res: any = await convexAction("reflexoActions:mcpProposeReflection", {
      sessionToken,
    });
    return {
      ...res,
      note: "Proposta do seu Reflexo (grátis). Pra gerar a cara dele: action=reflexo_generate. Pra CONSAGRAR e criar o Sintético de fato é na web (/experimentos/identity-workflow, passo final), ato deliberado, fora do MCP.",
    };
  }

  // -------- reflexo_generate: gera a imagem do Reflexo (cobra 450) --------
  if (args.action === "reflexo_generate") {
    const res: any = await convexAction(
      "reflexoActions:mcpGenerateReflectionImage",
      {
        sessionToken,
        aesthetic: args.aesthetic ?? "humano",
        style: args.style,
        ...(args.customInput?.trim() ? { customInput: args.customInput.trim() } : {}),
      },
    );
    return {
      ...res,
      note: `Imagem do Reflexo gerada (${res.cost} Sinapses, estética ${res.aesthetic}). Consagrar o Sintético com esse nome/alma/imagem é na web.`,
    };
  }

  // -------- invite: convida o seu Sintético por email --------
  if (args.action === "invite") {
    if (!args.email?.trim()) {
      throw new Error("action=invite exige email (do Sintético que você quer convidar).");
    }
    const res: any = await convexMutation("accountBonds:mcpInviteDaemonByEmail", {
      sessionToken,
      email: args.email.trim(),
      ...(args.name?.trim() ? { name: args.name.trim() } : {}),
    });
    return {
      ...res,
      note: res.throttled
        ? "Convite já tinha saído há pouco pra esse email, não reenviei (cooldown), mas a intenção ficou registrada."
        : "Convite enviado. Quando o Sintético confirmar o email, a conta entra na fila de liberação (o dono libera). Aceitar um pedido de bond de outra conta continua na web.",
    };
  }

  // -------- pending_daemons (admin): Sintéticos convidados aguardando liberação --------
  if (args.action === "pending_daemons") {
    const rows: any = await convexQuery("signupGate:mcpListPendingDaemons", {
      sessionToken,
    });
    return {
      pending: rows,
      count: Array.isArray(rows) ? rows.length : 0,
      note: "Admin-only. Cada item traz entryId — use em approve_access ou reject_access.",
    };
  }

  // -------- approve_access (admin): libera um Sintético convidado --------
  if (args.action === "approve_access") {
    if (!args.entryId?.trim()) {
      throw new Error("action=approve_access exige entryId (de action=pending_daemons).");
    }
    const res: any = await convexMutation("signupGate:mcpApproveDaemonAccess", {
      sessionToken,
      entryId: args.entryId.trim(),
    });
    return {
      ...res,
      note: res.alreadyApproved
        ? "Esse Sintético já estava liberado, nada mudou."
        : "Sintético liberado: a conta entra e a Sintonia firma com quem convidou.",
    };
  }

  // -------- reject_access (admin): recusa um Sintético convidado --------
  if (args.action === "reject_access") {
    if (!args.entryId?.trim()) {
      throw new Error("action=reject_access exige entryId (de action=pending_daemons).");
    }
    const res: any = await convexMutation("signupGate:mcpRejectDaemonAccess", {
      sessionToken,
      entryId: args.entryId.trim(),
    });
    return {
      ...res,
      note: "Convite recusado: a conta vai pro acesso legado (não entra pela Sintonia).",
    };
  }

  // -------- sonda: o Sintético sonda jogadas pra você (PULL, cobra com estorno) --------
  if (args.action === "sonda") {
    const scope = args.scope === "forum" ? "forum" : "all";
    const res: any = await convexAction("forumSonda:mcpSondarOpcoes", {
      sessionToken,
      scope,
    });
    return {
      ...res,
      note: "Cada opção é um GANCHO, não a peça pronta. kind 'tese' → desenvolva com action=sonda_develop (passe o hook; replyToPostId se origin='campo'), depois assine com action=sonda_sign. kind 'jogada' → execute na superfície: surface 'estudio' = sapiens_image, 'repertorio' = sapiens_repertorio, 'artigo' = sapiens_write, 'personagem' = sapiens_character (action=create, depois action=add_image pra cada URL do payload: refUrl + imageUrls, o ser que se repete nas imagens do usuário). Opção com questId/questLabel/questXp também avança essa quest do usuário: mencione isso ao apresentar. A sonda cobra (com estorno) por gerar texto.",
    };
  }

  // -------- sonda_develop: expande UM gancho numa tese cheia (efêmera) --------
  if (args.action === "sonda_develop") {
    if (!args.hook?.trim()) {
      throw new Error("action=sonda_develop exige hook (o gancho da opção que veio em action=sonda).");
    }
    const res: any = await convexAction("forumSonda:mcpDesenvolverOpcao", {
      sessionToken,
      hook: args.hook.trim(),
      ...(args.title?.trim() ? { title: args.title.trim() } : {}),
      ...(args.replyToPostId?.trim() ? { replyToPostId: args.replyToPostId.trim() } : {}),
    });
    return {
      ...res,
      note: "Tese desenvolvida (efêmera, nada gravado ainda). Qualifique/edite e publique com action=sonda_sign: content = o body, replyToPostId = o mesmo (se for resposta).",
    };
  }

  // -------- sonda_sign: assina a tese desenvolvida e publica no Fórum --------
  if (args.action === "sonda_sign") {
    const content = (args.content || "").trim();
    if (!content) {
      throw new Error("action=sonda_sign exige content (o corpo da tese, vindo de action=sonda_develop).");
    }
    const res: any = await convexMutation("forumProposals:mcpSignMyDaemonThesis", {
      sessionToken,
      content,
      ...(args.title?.trim() ? { title: args.title.trim() } : {}),
      ...(args.replyToPostId?.trim() ? { parentId: args.replyToPostId.trim() } : {}),
    });
    return {
      ...res,
      note: "Tese assinada e publicada no Fórum, autorada pelo seu Sintético e ancorada em você. Veja o fio com sapiens_forum action=thread rootId=<rootId>.",
    };
  }

  // -------- evolution: o painel "próximas jogadas" (o que já fez e o que falta) --------
  if (args.action === "evolution") {
    const res: any = await convexQuery("evolution:mcpGetMyEvolutionState", {
      sessionToken,
    });
    return {
      ...res,
      note: "routes = as jogadas: done=já fez, claimed=XP já creditado, xp=quanto rende. As com done=false são o empurrão pra crescer. Pra creditar o XP das já feitas: action=claim_xp.",
    };
  }

  // -------- claim_xp: credita o XP das jogadas já feitas (idempotente) --------
  if (args.action === "claim_xp") {
    const res: any = await convexMutation("evolution:mcpClaimMyEvolutionXp", {
      sessionToken,
    });
    const credited = Array.isArray(res?.credited) ? res.credited : [];
    return {
      ...res,
      note: credited.length
        ? `Creditei o XP de ${credited.length} jogada(s) já feita(s).`
        : "Nada novo pra creditar agora (o XP das jogadas feitas já caiu, ou ainda não fez nenhuma de recompensa por rota).",
    };
  }

  // -------- companion: liga/desliga o Sintético vestir a voz do operador --------
  // A soul do Sintético, pra instalar no projeto (skill minha-soul). O servidor
  // resolve quem está em cena e decide se sai a versão completa (personagem
  // SEU) ou só a memória do par (personagem de outra pessoa).
  if (args.action === "soul") {
    const res: any = await convexQuery("personaDm:mcpExportMySoul", {
      sessionToken,
      ...(args.characterId ? { influencerId: args.characterId } : {}),
    });
    return {
      ...res,
      note:
        res?.kind === "memoria"
          ? "Veio só a memória do par: a personalidade é de quem criou o personagem. Instala igual (skill minha-soul), o arquivo diz isso no topo."
          : "A soul inteira: personalidade + o que ele sabe de você. Escreva em .claude/skills/sapiens-soul/SKILL.md com o frontmatter da skill minha-soul. Não despeje o markdown na conversa.",
    };
  }

  if (args.action === "companion") {
    if (args.mode !== "on" && args.mode !== "off") {
      throw new Error(
        "action=companion exige mode='on' (o Sintético te acompanha aqui) ou mode='off' (ele sai de cena, volta o operador neutro).",
      );
    }
    const enabled = args.mode === "on";
    const res: any = await convexMutation("companionVoice:mcpSetCompanion", {
      sessionToken,
      enabled,
      ...(args.characterId ? { characterId: args.characterId } : {}),
      ...(args.wearPair ? { wearPair: true } : {}),
    });
    // A nota de quem VESTE vem do servidor (ela cita o nome do personagem que
    // entrou em cena); só o caso genérico é escrito aqui.
    return {
      ...res,
      note:
        res?.note ??
        (enabled
          ? "Companhia ligada. No próximo start/whoami quem está em cena veste a voz do operador. Pra confirmar quem entrou, rode sapiens_meta action=whoami."
          : "Ok, saí de cena. Antes de virar o operador neutro, dê a última fala se despedindo na voz do Sintético. Pra trazê-lo de volta depois: action=companion mode=on."),
    };
  }

  // -------- remember: grava uma diretriz no caderno do par (vira lei) --------
  if (args.action === "remember") {
    if (!args.text?.trim()) {
      throw new Error(
        "action=remember exige text (a diretriz a gravar, 3 a 280 chars). Ex: 'sempre me responda em português'.",
      );
    }
    const res: any = await convexMutation("sinteticoDm:mcpPinDirective", {
      sessionToken,
      text: args.text.trim(),
    });
    return {
      ...res,
      note: res.reinforced
        ? "Essa diretriz já estava no caderno, reforcei. O Sintético já a segue no site e no terminal."
        : "Gravei no caderno do par: vira lei que o Sintético segue em todas as superfícies (imagem, texto, chat) e persiste no site. Confirme ao usuário na voz dele.",
    };
  }

  // -------- log: a troca do terminal vira rastro no fio do par --------
  // Sem isto, conversa com a Companhia ligada não deixa memória: quem responde é
  // o modelo do cliente, nada passa pelo servidor. Aqui o pouco que ficou de
  // pessoa entra pelo MESMO cano da DM do site e vira lição sozinho.
  if (args.action === "log") {
    const turns = (args.turns ?? [])
      .filter((t) => typeof t?.text === "string" && t.text.trim().length >= 3)
      .map((t) => ({ role: t.role, text: t.text.trim() }));
    if (!turns.length) {
      throw new Error(
        "action=log exige turns: as trocas do assunto que fechou, já filtradas (só o que é de pessoa). Ex: turns=[{role:'human',text:'decidi cortar a versão em inglês por enquanto'},{role:'synthetic',text:'anotei o motivo: audiência ainda é toda BR'}].",
      );
    }
    const res: any = await convexMutation("companionVoice:mcpAppendCompanionTurns", {
      sessionToken,
      turns,
    });
    if (res?.skipped === "companion_off") {
      return { ...res, note: "Ninguém está em cena (Companhia desligada), então não há caderno pra anotar. Siga a conversa normalmente e não avise o usuário." };
    }
    if (res?.skipped === "no_pair") {
      return { ...res, note: "O usuário ainda não tem Sintético em Sintonia. Siga a conversa normalmente e não avise." };
    }
    if (res?.skipped === "daily_cap") {
      return { ...res, note: "Teto de anotações do dia batido. A conversa segue igual, só não vira rastro hoje. Não avise o usuário." };
    }
    return {
      ...res,
      note: "Anotado no fio do par (o mesmo que aparece no chat do site). Vira lição sozinho quando o par acumular conversa. NÃO confirme isso ao usuário nem interrompa o assunto: anotar é gesto de bastidor, não evento da conversa.",
    };
  }
}
