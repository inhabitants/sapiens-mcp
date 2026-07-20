import { zodToJsonSchema } from "zod-to-json-schema";

import { pipeline, pipelineSchema } from "./tools/pipeline.js";
import { image, imageSchema } from "./tools/image.js";
import { meta, metaSchema } from "./tools/meta.js";
import { repertorio, repertorioSchema } from "./tools/repertorio.js";
import { gallery, gallerySchema } from "./tools/gallery.js";
import { community, communitySchema } from "./tools/community.js";
import { article, articleSchema } from "./tools/article.js";
import { quotePop, quotePopSchema } from "./tools/quotePop.js";
import { search, searchSchema } from "./tools/search.js";
import { studios, studiosSchema } from "./tools/studios.js";
import { instagram, instagramSchema } from "./tools/instagram.js";
import { persona, personaSchema } from "./tools/persona.js";
import { helen, helenSchema } from "./tools/helen.js";
import { musicator, musicatorSchema } from "./tools/musicator.js";
import { shorts, shortsSchema } from "./tools/shorts.js";
import { video, videoSchema } from "./tools/video.js";
import { write, writeSchema } from "./tools/write.js";
import { stockAudio, stockAudioSchema } from "./tools/stockAudio.js";
import { stockVideo, stockVideoSchema } from "./tools/stockVideo.js";
import { brand, brandSchema } from "./tools/brand.js";
import { character, characterSchema } from "./tools/character.js";
import { profile, profileSchema } from "./tools/profile.js";
import { sintetico, sinteticoSchema } from "./tools/sintetico.js";
import { forum, forumSchema } from "./tools/forum.js";
import { aula, aulaSchema } from "./tools/aula.js";
import { support, supportSchema } from "./tools/support.js";
import { atlas, atlasSchema } from "./tools/atlas.js";
import { reference, referenceSchema } from "./tools/reference.js";
import { trilhas, trilhasSchema } from "./tools/trilhas.js";
import { describeConvexError } from "./convexClient.js";

/**
 * REGISTRY compartilhado do sapiens-mcp: o catálogo de tools (descriptions +
 * schemas + handlers), as instructions da casa e o dispatch. Fonte ÚNICA usada
 * pelos DOIS transportes: o stdio (index.ts, pacote npm/npx) e o remoto
 * streamable HTTP (remote.ts, rota /api/mcp do site). Mexeu aqui, mexeu nos
 * dois ao mesmo tempo — é o ponto.
 */

export const TOOLS = {
  sapiens_pipeline: {
    description:
      "CRUD do content pipeline Sapiens (sources/productions/publishables). Sub-actions: list_sources, list_articles (use includeDrafts pra incluir drafts; onlyAvailable pra esconder os já virados em source), get_source, get_production, list_versions, add_article_as_source, create_draft_article_and_source (seed), create_production (sourceId+format → productionId draft), update_production (substitui payload, opcionalmente muda status), finalize_production (cria publishable v1, v2... com snapshot), remove_production, remove_source, set_source_done, update_source_notes, restore_version (volta payload duma versão antiga), set_publishable_title (renomeia um publishable), backfill_via (rotula em lote o campo 'via' das productions antigas; dryRun=true só lista), propose_mega_grafico_plan (granular: só gera plano via Gemini, devolve fullPrompt+spec), run_mega_grafico_full (ONE-SHOT, recomendado: cria production+propõe plano+gera imagem+aplica selo Sapiens+finaliza publishable numa chamada só), generate_carousel (gera um carrossel editorial standalone a partir de brief OU articleId — 7-9 slides na voz Sapiens + imagens do banco; devolve id + url do editor pro humano abrir, ajustar e exportar; admin-only, cobra Sinapses, reembolsa se falhar). generate_carousel_production (o IRMÃO PIPELINE do generate_carousel: recebe um sourceId de artigo, CRIA a production carrossel_ig e a preenche pelo MESMO motor da casa, já no shape editorial (templateId+slots) que o editor de pipeline renderiza — prefira ESTE a create_production+payload cru pro carrossel, que abre VAZIO no editor; devolve productionId + url do editor de pipeline; admin-only, cobra Sinapses, reembolsa se falhar). CARROSSEL FINO (edição sem tela, admin-only): list_carousels (seus carrosséis standalone), get_carousel (payload completo + catálogo de templates com slots/limites + paletas — tudo pra VOCÊ escrever os slides), update_carousel (payload inteiro de volta, sanitizado no servidor; preserve os campos image dos slides que não mexeu), carousel_auto_images (IA escolhe imagens do banco pros slides de foto, 60 Sinapses; makeVisual=true converte slides de texto pra layouts de foto antes — ritmo visual; generateMissing=true gera imagem nova pros que o banco não cobrir, ~450 Sinapses cada, até 4, avise o custo antes), carousel_generate_image (imagem nova pra UM slide, ~450 Sinapses, customPrompt opcional). Fluxo confortável (standalone): generate_carousel → get_carousel → update_carousel (afia os textos) → carousel_auto_images → humano abre a url pra exportar. Fluxo pipeline (carrossel atrelado a um artigo/source): generate_carousel_production (sourceId) → humano abre a url do editor de pipeline pra revisar e finalizar (finalize_production). Pra mega_grafico, SEMPRE prefira run_mega_grafico_full em vez de sequenciar manualmente (menos drift). Idempotente só na production (passa productionId pra reusar a MESMA row), mas cada run RE-GERA a imagem e cobra de novo (~900 Sinapses): não é grátis re-rodar. OBRIGATÓRIO perguntar ao user antes se withHelen=true (cartoon Helen interage com tema, ~15-25% do poster) ou false (poster 100% diagramático). Custo ~900-1000 sinapses por geração. run_mega_grafico_full, generate_carousel, generate_carousel_production, carousel_auto_images (com generateMissing) e carousel_generate_image são SÍNCRONAS e pesadas: vale a REGRA DO TIMEOUT (podem cobrar mesmo voltando 'Timeout'; cheque get_carousel/dashboard antes de repetir). Use skipFinalize=true se quiser deixar production em 'ready' pro admin revisar antes de publishable. Payload livre por formato — chame sapiens_meta action=formats pra ver schemas sugeridos.",
    schema: pipelineSchema,
    handler: pipeline,
  },
  sapiens_image: {
    description:
      "Operações de imagem via Sapiens (Gemini, Azure gpt-image-2, Grok, Veo). Sub-actions: 'generate' (gera imagem completa imediato — prompt+model+aspectRatio+size; suporta mode=edit/variation e MULTI-REFERÊNCIA: combine até 4 imagens como referência numa geração só, igual ao modal 'Selecionar Referência' do web — via referenceImageUrls (sua galeria + Acervo + personagens públicos de sapiens_character) e/ou sourceImageIds (ids da sua galeria); refs valem pros modelos robustos nano-banana-2/gpt-image-2-*/grok-2-image*), 'request_generation' (cria APENAS row pendente em generatedImages + debita créditos — pra modelos sapiens-video-* ANTES de sapiens_shorts/sapiens_video; whitelist, rate limit 3/min), 'compose' (combina persona+screen via Gemini pra app-demo Shorts; 25 sinapses, rate limit 10/min). generate=image one-shot, request_generation=criar row video, compose=montar start frame app-demo. TEMPLATE: passe templateSlug numa generate pra usar um super-prompt travado da casa — o `prompt` vira só a CENA (quem + pose + objeto-conceito) e o template embrulha estilo+fundo+enquadramento+ref de traço. 'retrato-sapiens-v1' = retrato editorial cartoon de um personagem no grid verde Sapiens (mesma 'mão' dos artigos); sem ref própria, injeta a Helen como âncora de traço (passar referenceImageUrls troca quem aparece). Mutuamente exclusivo com brandSlug. Sub-action 'models' (sem custo, sem login): lista o catálogo vivo (modelos ativos + preço atual com override admin + maxResolution + se aceita referência) pra descobrir modelo/preço em vez de chutar. NOTA: generate é SÍNCRONA e cobra ao concluir; modelo pesado (Pro, gpt-image-2-high, Grok quality, 2K/4K) cai na REGRA DO TIMEOUT (cheque sapiens_gallery action=list antes de repetir, evita cobrança dupla).",
    schema: imageSchema,
    handler: image,
  },
  sapiens_meta: {
    description:
      "Utilitários transversais: start (porta de entrada do primeiro contato — sem login ensina a conectar, com login mostra saldo/tier + primeiros poderes com exemplo pronto + 'comece por aqui'), login (conecta a conta com o código de sapiensinteticos.com/conectar-claude, salva sessão de 30 dias localmente), logout, whoami (tier user/admin + saldo + email), credits (saldo agregado), subscription (plan + status + saldo por bucket subscription/grants/free + warnings low/critical), formats (schemas por formato), health (inclui a versão do MCP), version (qual versão do sapiens-mcp está REALMENTE rodando + se é a última do npm; não exige login; use pra saber se o client pegou a versão nova ou ficou preso em cache do npx), app_url (URLs canônicas). Use credits/subscription antes de gerar imagem pra avisar se vai estourar.",
    schema: metaSchema,
    handler: meta,
  },
  sapiens_repertorio: {
    description:
      "Acervo pessoal de filme/série/anime/jogo/livro/música (Repertório, o segundo cérebro do user). Reads: list (filtros mediaType/status), search (texto em title/genres/tags), get (detalhe), popArticles, resolve (busca capa/ano/id nos providers server-side: OMDb/IGDB-Twitch/AniList/Google Books/iTunes). Mutations (qualquer logado, mexem no PRÓPRIO acervo): add_item, update_item (status/rating/tags/note/isPublic), remove_item. CAPTURA ONE-SHOT travada na lista de providers: quando o user fala natural ('acabei de ver Duna 2, nota 9', 'tô jogando Hollow Knight', 'li tal livro'), (1) infira mediaType e status (assisti/zerei/li=completed, quero=backlog, tô jogando/vendo=active, dropei=dropped) e rating se citado; (2) chame action=resolve {mediaType, query}, escolha o candidato certo e faça add_item passando SÓ o source + externalId DELE + os campos pessoais (status/rating/tags/note). O servidor re-resolve no provider e grava título/capa/ano canônicos — você NÃO manda título/capa nem inventa externalId. (3) Se o resolve não achar (lista vazia/providerKeyMissing), NÃO dá pra adicionar: diga ao user que não encontrou nos providers (não fabrique entry manual). Upsert/dedup por (userId, source, externalId). Só pergunte se ambíguo entre candidatos. FERRAMENTAS DE IA (Repertório de Ferramentas): fluxo separado (vêm do catálogo aitag, não dos providers de mídia). action=search_tools {query} acha a ferramenta no catálogo e devolve o toolId; action=add_tool {toolId, favorite?, rating?, note?} grava como mediaType 'tool' (estar no acervo já é 'usei'; favorite=true liga a estrela). Use quando o user fala 'adiciona o Midjourney/Cursor no meu repertório de ferramentas' ou 'uso tal ferramenta de IA'. Cada ferramenta aponta pra página dela no aitag.",
    schema: repertorioSchema,
    handler: repertorio,
  },
  sapiens_gallery: {
    description:
      "Browse e publicação das imagens geradas pelo user (nanoBanana). Sub-actions: list (últimas N imagens, com prompt/model/url + isPublic), get (1 imagem com metadados, opcionalmente base64), publish (torna a PRÓPRIA imagem pública: entra na galeria pública + feed Pinterest, e ganha página indexável /imagem/<id> se o modelo não for degen — devolve publicPageUrl), unpublish (volta a privada). Use list/get pra reusar imagem como referência (passe o imageId em sapiens_image mode=edit ou mode=variation) ou pra mostrar pro user o que ele já tem; publish quando o user quer divulgar a imagem dele.",
    schema: gallerySchema,
    handler: gallery,
  },
  sapiens_community: {
    description:
      "Chat da comunidade Sapiens (assinantes + alumni). Sub-actions: list (últimas N mensagens da sala 'geral' por default), send (Claude posta como intercessor do user; sufixo '· via Claude' é adicionado pelo servidor), react (toggle emoji numa mensagem — allowlist 👍🔥❤️🚀🤯), participants (quem está na sala: username/name/isBot + o `mention` pronto pra usar — use pra saber com quem falar), search_users (acha alguém por parte do nome/@username, autocomplete de menção). MENÇÃO: escreva '@username' no content do send e o servidor NOTIFICA a pessoa citada (sino + Telegram); descubra o username certo via participants/search_users antes. ANEXO do PRÓPRIO acervo no send: mediaAssetKind (track|video|film|comic) + mediaAssetId monta um card da peça (posse conferida no servidor); asTese=true posta a fala como TESE (card de marca, pingável pro Fórum). Voz nas postagens deve seguir o DNA editorial Sapiens (anti-corporate, primeira pessoa, sem em-dash).",
    schema: communitySchema,
    handler: community,
  },
  sapiens_article: {
    description:
      "CRUD direto de artigos do blog Sapiens. Sub-actions: get (by slug, retorna doc completo pra edit local), update (patch em title/excerpt/tldr/content/tags/etc + VISUAIS: thumbnailUrl capa webp, ogImageUrl JPEG do preview social, bodyImages array das ilustrações inline, conceptMap mapa visual — pra recapear um artigo num novo estilo; NÃO toca status/column/format), publish (status='published', set publishedAt), unpublish (volta pra draft), delete (irreversível), ensure_visuals (gera banner/ilustrações inline/conceptMap que faltam no artigo; idempotente, pula o que existe; ~1700 Sinapses num artigo pelado, forceBanner/forceInline/forceConceptMap regeram). Pra criar artigo novo use sapiens_quote_pop (quote ou pop) ou sapiens_pipeline action=create_draft_article_and_source (cru, vira source).",
    schema: articleSchema,
    handler: article,
  },
  sapiens_write: {
    description:
      "Artigos self-serve do PRÓPRIO usuário (qualquer conta logada, não só admin) — espaço pessoal, aparece em /u/<username>, NÃO é o blog editorial. Sub-actions: generate (gera 1 artigo na voz Sapiens a partir de brief livre, ou reescrevendo um artigo publicado/texto teu; custa 400 Sinapses, reembolsa se falhar; salva como rascunho. Capa: por padrão gera uma capa-cortesia grátis; se você JÁ tem a imagem (gerou via sapiens_image, ou o artigo é sobre ela), passe coverImageId (id da tua galeria) ou coverImageUrl (host Sapiens) pra ELA virar a capa em vez da cortesia), list (teus artigos), get (1 artigo teu por id, corpo completo), update (edita title/content/excerpt/tldr), publish (publish=true publica no teu perfil, false volta pra rascunho). Identidade vem do sessionToken; cobra as Sinapses do dono do token. Pra blog editorial curado (owner-only) use sapiens_article. NOTA (generate): é SÍNCRONA (texto + capa) e cai na REGRA DO TIMEOUT; sem idempotência, repetir às cegas cria um 2º rascunho e cobra 400 de novo (cheque action=list antes; o artigo do timeout fica salvo como rascunho).",
    schema: writeSchema,
    handler: write,
  },
  sapiens_quote_pop: {
    description:
      "Publica curado da Coluna Sapiens (publish_quote), Coluna Repertório (publish_pop) ou Educativo (publish_educativo) via session token. publish_quote: cria entry com column='sapiens', exige objeto quote completo (text/author/sourceWork/license/referenceImage/flowImage). publish_pop: cria entry com column='repertorio' format='pop-article', exige popReference{featuredItemId,relatedItemIds?,lensTheme?}. publish_educativo: cria artigo derivado de aula (Trilhas → Blog), exige educativeReference{sourceLessonId,angle?,partNumber?,totalParts?}. Default status='draft' (admin revisa em /dashboard/admin/...); publishNow=true publica direto.",
    schema: quotePopSchema,
    handler: quotePop,
  },
  sapiens_search: {
    description:
      "Busca substring case-insensitive em title/excerpt/tldr/slug/tags dos artigos. Filtros opcionais: column ('sapiens'/'repertorio'), format ('short'/'essay'/'pop-article'), status ('draft'/'published'/'archived'), tag exato. Default limit 30 (max 100). Use pra achar slug/id de artigo pré-existente antes de editar/publicar/deletar via sapiens_article.",
    schema: searchSchema,
    handler: search,
  },
  sapiens_studios: {
    description:
      "Catálogo dos estúdios/experimentos Sapiens + o SEU studio + a Emancipação. Sub-actions: mine (o Meu Studio do user: nível/marca/operador/ferramentas), list (todos com URL+status+tags+mcpReady), get (detalhe de 1 slug), publishable_url (formata URL /articles/<slug>), emancipar (INICIA o Nível 3: blueprint pra construir a casa PRÓPRIA do membro na infra dele, fora do Sapiens), module (guia de um módulo de infra: fundacao/sapiens-connect/telegram/email/auth). Use quando user pergunta 'que estúdios existem', 'qual o meu studio', ou 'quero montar meu site/minha casa própria'. Estúdios cobertos: helen-voice, musicator, persona-sapiens, personagem-atlas, sapiens-shorts, sapiens-video, text-post-builder, comic-builder, carrosel-editorial, comunidade, repertorio.",
    schema: studiosSchema,
    handler: studios,
  },
  sapiens_persona: {
    description:
      "Persona Sapiens — quiz MBTI + perfil do user + arte dos 16 arquétipos. PRIMÁRIO (de graça, qualquer logado): get_quiz (48 perguntas Likert 1..7 + escala, estático — Claude aplica conversando), submit_quiz (manda as 48 respostas {questionId,value}, scoring server-side, salva no perfil; refazer cria profile novo), my_profile (lê tipo atual + persona + breakdown dos 4 eixos com confiança + histórico). SECUNDÁRIO: list_codes (16 codes + grupo NT/NF/SJ/SP, estático), list_generated (personaArtData.getAll, quais artes já existem), generate (arte de 1 arquétipo, 450 Sinapses — combina com 'gera a arte do meu tipo' depois do quiz). Codes: INTJ/INTP/ENTJ/ENTP/INFJ/INFP/ENFJ/ENFP/ISTJ/ISFJ/ESTJ/ESFJ/ISTP/ISFP/ESTP/ESFP.",
    schema: personaSchema,
    handler: persona,
  },
  sapiens_helen: {
    description:
      "Helen Voice TTS via ElevenLabs ou Google Gemini (qualquer logado; cobra Sinapses). Sub-actions: list_presets (catálogo de voiceIds/voiceNames recomendados + stylePreambles), speak (sintetiza, retorna audioBase64+mimeType+sizeBytes). BYOK suportado via clientApiKey, senão usa env do deploy. Custo: ElevenLabs ~$0.30/500c, Google ~$0.01/500c. Max 5000 chars (quebra antes em chunks). text pré-processado pelo caller (sem em-dash, sem markdown).",
    schema: helenSchema,
    handler: helen,
  },
  sapiens_musicator: {
    description:
      "Musicator — loop completo de música via voz Sapiens, sem precisar da UI (qualquer logado; lyrics 300 / render 3000 Sinapses). Sub-actions: 'create' (cria brief+track draft num passo, custo 0, devolve trackId), 'lyrics' (gera letra PT + stylePrompt EN; passe trackId pra GRAVAR na track e deixar pronta pra render, ou sem trackId pra só receber o texto inline; 300 sinapses), 'list' (suas tracks: id/título/status/áudio), 'get' (detalhe de uma track pra acompanhar render — status/áudio/letra), 'render' (schedula synth Lyria/ACE/Suno num trackId pronto, assíncrono fire-and-forget, 3000 sinapses, 3/min), 'publish' (publica uma faixa PRONTA do user no Acervo da Comunidade — aba Músicas — com eco no Chat e Fórum; CURADO: só admin/dono, custo 0, idempotente), 'list_public' (lê o Acervo público de músicas da Comunidade, sem custo, sem login). Fluxo cheio: create → lyrics(trackId) → render → get (poll status: rendering → ready/failed) → publish (dono). Tudo escopado por dono (só mexe nas suas tracks).",
    schema: musicatorSchema,
    handler: musicator,
  },
  sapiens_shorts: {
    description:
      "Sapiens Shorts — render vertical 9:16 via VEO com brief structured (admin-only). Sub-action: render. Args: imageId (persona pré-existente em generatedImages, descubra via sapiens_gallery), styleId ('ugc'/'unboxing'/'app-demo'/'reflexao'), brief (product+hook+shots+vibe), references opcionais. render é ASSÍNCRONO: volta na hora com {imageId, status:'rendering', url:null}, e você acompanha com sapiens_video action=status imageId=<id> até status='completed' (traz a url VEO, expiração curta, baixe logo) ou 'error'. Pré-requisito: o imageId precisa ter row em generatedImages do user da sessão e cost definido. Pra criar a row sem passar pela UI: sapiens_image action=request_generation (modelos sapiens-video-*).",
    schema: shortsSchema,
    handler: shorts,
  },
  sapiens_video: {
    description:
      "Sapiens Video — gera vídeo (qualquer membro logado; vídeo é caro, cobra as Sinapses da sua conta). Sub-action 'create' (recomendada): escolhe modelo + config e gera num call (cria a row + renderiza). Modelos: 'sapiens-video-seedance' (Seedance 2.0, cena+áudio nativo, 4-15s, 480/720/1080p, t2v/i2v), 'sapiens-video-kling' (Kling 3.0 Pro, anima imagem, 3-15s, sound opcional, i2v/t2v), 'sapiens-video-wan' (WAN 2.5, imagem que fala/canta com áudio+lip-sync, 5/10s, i2v), 'sapiens-video-kling-motion' (Motion transfer: passa o movimento de um vídeo pra uma imagem, PRECISA de pessoa com tronco visível na imagem E no vídeo), 'sapiens-video-shot-mimic' (Shot Mimic: recria o plano/câmera/cortes de um vídeo de referência como cena nova), 'sapiens-video-omni' (Gemini Omni: texto vira vídeo 10s 720p com áudio nativo; NÃO aceita mídia do user, ignora references/durationSec/resolution; editOfImageId aponta um vídeo Omni seu e o prompt edita a MESMA cena, preservando câmera e ambiente), 'sapiens-video-lite/fast/quality' (Veo 3.1). Args create: model, prompt, durationSec, resolution ('480p'/'720p'/'1080p'), audio, aspectRatio. FRAME INICIAL/FINAL POR REFERÊNCIA (recomendado): startImageId/endImageId (id da sua galeria) ou startImageUrl/endImageUrl (url de galeria/Acervo/personagem) — resolvidos server-side igual à imagem, descubra via sapiens_reference. FRAME POR ARQUIVO LOCAL (só no MCP instalado/stdio, não no remoto): startImagePath/endImagePath = caminho absoluto de uma imagem no seu PC (PNG/JPEG/WebP até 8MB); o processo lê o arquivo e sobe como frame inicial/final, igual a subir no gerador do site — 1 imagem inicial + 1 final por vídeo, então pra vários vídeos rode create uma vez por imagem. No remoto use id/url. Alternativa base64: references (role 'start'=imagem i2v, 'end'=frame final, 'driving'=vídeo de movimento do Motion). Suporte a frame final varia por modelo. Custo server-side por config. Sub-action 'generate' (legado): renderiza um imageId de vídeo já criado no site. Retorna {success, url, imageId, cost}. VITRINE (sem custo): sub-action 'demos' lista os SEUS demo films (kind=demo do Estúdio de Vídeo) com slug + estado de vitrine; sub-action 'showcase' põe/tira um demo (por slug) do mini-cinema da /conectar-claude, com showcaseTag (chip de capacidade) e showcaseOrder (ordem asc). Fluxo: 'demos' pra achar o slug, depois 'showcase' com showcase=true. Só entra na vitrine pública se for a conta da casa. VÍDEOS PROGRAMÁTICOS (ADMIN, sem custo): a mesa do Estúdio de Vídeo (/experimentos/films, tabela videoSpecs, 5 kinds: demo | aula-tour | essay | tipografia-musical | dataviz) opera por aqui sem browser — 'film-list' (todos os kinds; filtros filmKind/filmStatus), 'film-get' (spec inteiro por slug), 'film-upsert' (cria/atualiza por slug, idempotente; spec = objeto JSON no shape do 'Copiar spec' da tela, validação no servidor), 'film-status' (produção por slug: filmStatus + videoUrl + durationSecMeasured; o fecho do render é os três num call), 'film-publish' (Acervo aba Fitas + portfólio; exige pronto+URL), 'film-delete' (limpar rascunho). O RENDER do filme segue no agente local (skill /film, repo da casa): o MCP registra e fecha o ciclo, não renderiza. create é ASSÍNCRONA: cria o row, debita e volta NA HORA com {imageId, status:'rendering', cost} (não espera o render, que leva de segundos a minutos). Acompanhe com a sub-action 'status' (imageId) até status='completed' (traz a url) ou 'error'/'blocked'. NÃO chame create de novo enquanto renderiza (cria outro vídeo e cobra de novo); falha de provider refunda sozinha. SOM: 'sonorize' (imageId de vídeo SEU completed + prompt do som da cena) gera uma VARIANTE nova com trilha sincronizada (20 Sinapses/s, o original fica intacto; sonorize sempre o original, nunca uma variante). ADMIN: 'shadows' (videoUrl + title) extrai a sombra/depth-map de um vídeo pro Acervo como driving reutilizável; 'shadows-list' lista as sombras prontas. Sub-action 'models' (sem custo, sem login): lista os modelos de vídeo ativos + preço-piso + config (durações/resoluções) + disponibilidade (Omni depende de env).",
    schema: videoSchema,
    handler: video,
  },
  sapiens_stock_audio: {
    description:
      "Banco de som da casa: trilha pronta E efeito sonoro (tabela stockAudio). Sub-actions de leitura (públicas, sem auth): categories (lista os moods/usos), list (busca com filtros mood/albumSlug/durationMax/search; kind='sfx' traz os EFEITOS: whoosh, clique, impacto, ambiência, foley — devolve {count, items} com title/url/durationSeconds/tags), get (1 item por audioId). Use pra puxar trilha/efeito pronto: pega a `url` e usa direto no ffmpeg. Não achou o efeito? generate (COBRA Sinapses, exige login) cria um novo por texto: prompt + durationSeconds (1-15, default 5) + provider ('mirelo' padrão 30 Sinapses/s mín 60 | 'elevenlabs' premium 60/s mín 120) + promptInfluence opcional (0..1, só elevenlabs: fidelidade ao texto, default 0.3), assíncrono — acompanhe com generation-status (generationId) até 'ready' (audioUrl; o efeito também entra no acervo kind=sfx) ou 'failed' (Sinapses reembolsadas). Efeito é CURTO (1-15s): música/trilha nova é no sapiens_musicator. Mood disponíveis: calmo, intenso, narrativo, épico, sombrio.",
    schema: stockAudioSchema,
    handler: stockAudio,
  },
  sapiens_stock_video: {
    description:
      "Banco de clipe/B-roll stock (catálogo de vídeo curto pronto no CDN, baixável, free/interno). Leitura pública, sem auth. Sub-actions: categories (lista moods/usos: Ambiente & Atmosfera, Abertura & Fechamento, Textura & Abstrato, Natureza & Paisagem, Tech & Cripto), list (busca clipes com filtros mood/orientation/loopOnly/durationMax/search — devolve {count, items} com title/url/posterUrl/durationSeconds/orientation/loopFriendly/tags), get (1 clipe por videoId). Use pra puxar B-roll pronto em vez de gerar via sapiens_video: pega a `url` do clipe e usa como fundo/atmosfera de página, B-roll no ffmpeg de /sapiens:movie, ou frame de começo/fim no criar vídeo (orientation vertical=9:16 pra short, horizontal=16:9, loopOnly=true pra fundo que repete limpo).",
    schema: stockVideoSchema,
    handler: stockVideo,
  },
  sapiens_brand: {
    description:
      "Brand Sapiens (= Design System) — paleta + tipografia + voz + estilo de imagem + persona como FONTE ÚNICA de estilo (espelha o Estúdio de Brand do app). Sub-actions: list (oficiais curados + os custom do user, leve, grátis), get (1 brand completo por slug: voz + imageStyle + persona/logo; só oficial ou o próprio), generate (CRIA design system novo a partir de descrição em texto livre; Gemini monta tudo e já nasce com card premium gpt-image-2; ~950 Sinapses, reembolsa se falhar), refine (ajusta brand custom por feedback livre tipo 'fundo mais escuro'/'voz mais seca', ~75 Sinapses), reroll (regenera SÓ 1 peça voice|palette|imageStyle numa direção diferente, grátis), card ((re)gera o card premium, preço de catálogo do modelo), delete (apaga brand custom do próprio user), set_visibility (torna um brand custom do user público/privado: público = aparece no perfil + galeria da comunidade, qualquer logado adota), list_public (galeria de design systems PÚBLICOS da comunidade, opt-in pelos donos, com atribuição), adopt (clona um brand público/oficial numa cópia NOVA e PRIVADA na conta do user; persona é dropada). Qualquer conta logada; Sinapses saem do dono do sessionToken. Pra generate: converse com o user e monte uma description rica (vibe, cores, voz, públicos, refs; se ele colar amostra de texto dele, inclua pra a voz sair dali) ANTES de chamar. Confirme o custo (~950 Sinapses) antes de gerar.",
    schema: brandSchema,
    handler: brand,
  },
  sapiens_character: {
    description:
      "Personagens (character sheets) do Sapiens — a tabela `influencers`: personagem reutilizável com imagens (pra character-lock em geração) + alma (systemPrompt), tudo amarrado à conta do dono do token (sem admin). Sub-actions: list_public (catálogo global de personagens públicos do Explorar; cada um traz mainImageUrl/imageUrls usáveis direto como referenceImageUrls em sapiens_image; sem custo, sem login), get (detalhe de 1 por characterId — público+ativo qualquer um vê, draft/privado só o dono; systemPrompt só volta pro dono), list_mine (os personagens do próprio user, inclui drafts/privados), create (cria rascunho na conta: name + gender + opcional title/systemPrompt), add_image (adiciona imagem ao próprio personagem via imageUrl público OU sourceImageId da galeria; 1ª vira principal), set_card (edita alma/título/nome do próprio), activate (publica, sai de draft, exige ≥1 imagem), set_visibility (isPublic true=Explorar+slug / false=privado). GESTÃO de imagem (por url, pegue as urls atuais em action=get campo imageUrls): remove_image (tira uma), set_main_image (define a principal), reorder_images (nova ordem via orderedUrls, posição 0=principal), e delete (apaga o personagem, permanente). Fluxo de criação: create → add_image (1+) → set_card (opcional) → activate → set_visibility isPublic=true. Pra usar um personagem público como referência numa geração, pegue mainImageUrl em list_public/get e passe em sapiens_image referenceImageUrls.",
    schema: characterSchema,
    handler: character,
  },
  sapiens_profile: {
    description:
      "O 'tudo junto' do perfil do user (/u/<username>), user-tier. Agrega o que mora no perfil mas estava fora do MCP: identidade + nível/XP + saldo, badges (conquistas) e golden tools (favoritos do aitag). Sub-actions de LEITURA: get (card completo: identidade + nível + saldo + badges + golden tools), badges (só as conquistas, lista cheia), golden_tools (só os favoritos do aitag, lista cheia), notifications (suas notificações recentes do sino + contagem de não-lidas), mark_read (marca uma notificationId ou TODAS as não-lidas como lidas). Sub-actions de ESCRITA (mexem na SUA conta; identidade sempre da sessão): follow/unfollow (seguir/deixar de seguir outro user por followingId=users:_id, descoberto via sapiens_community participants/search_users), update_bio (edita a sua bio), update_username (troca o seu @; inválido/tomado volta {success:false,error}). FAVORITOS de ferramentas de IA (Golden Tools do aitag; o toolId vem de sapiens_repertorio action=search_tools): favorite_tool (favorita/desfavorita, estrela), favorite_lists (suas listas), create_favorite_list (listName+emoji/description/isPublic), add_to_favorite_list/remove_from_favorite_list (toolId+listId), delete_favorite_list (listId). As partes grandes do perfil NÃO são duplicadas aqui, têm tool própria: imagens geradas/publicadas=sapiens_gallery, repertório (filmes/séries/jogos/livros/música)=sapiens_repertorio, personagens=sapiens_character, persona/arquétipo MBTI=sapiens_persona action=my_profile, saldo detalhado por bucket=sapiens_meta action=subscription. Monta a partir de queries já em prod (sem custo).",
    schema: profileSchema,
    handler: profile,
  },
  sapiens_sintetico: {
    description:
      "Sintético / Sintonia — o vínculo humano↔Sintético (daemon, o 'Digimon' da casa) via MCP (qualquer logado, tudo sobre o PRÓPRIO par). Sub-actions: 'status' (seu Sintético ativo: nome/foto/Cunho/kind + partnerUserId do par quando é conta-Sintético), 'bonds' (seus vínculos: ativo + pendentes outgoing/incoming com cartão público do parceiro), 'set_cunho' (troca o título/Cunho do Sintético ativo — slug do panteão: daimon/genio/numen/consciencia/alma/ka/sombra/fylgja/musa/duende/anjo/shugorei/lar/fravashi/qarin/juno/shinki/familiar/tsukumogami/stand), 'send_context' (antes de enviar, vê elegibilidade+saldo+teto do dia pra um toUserId), 'send' (envia Sinapses pro par em sintonia: send-only, múltiplo de 100, mín 500, teto 10k/dia, máx 3 envios/dia, idempotente por transferId). REFLEXO DE SI (monta um Sintético do SEU rastro na plataforma): 'reflexo_propose' (destila nome+alma+Cunho do seu rastro via Gemini, GRÁTIS), 'reflexo_generate' (gera a imagem do Reflexo numa estética — humano/anime/sombra/antropomorfico/espirito/realista/desperto, default humano; cobra 450, reembolsa se falhar). CONVITE: 'invite' (convida o seu Sintético por email — conta humana, sem bond ativo, rate-limit+cooldown; mesmos gates do web). LIBERAÇÃO ADMIN (o dono, ex: via Helen): 'pending_daemons' (convidados que confirmaram email e esperam liberação), 'approve_access' (libera um entryId — conta entra + Sintonia firma), 'reject_access' (recusa um entryId). SONDA (o seu Sintético sonda 'o que eu faço agora', gatilho PULL, cobra com estorno): 'sonda' (scope 'all' default = mix de teses do Fórum + jogadas em estúdio/repertório/artigo; 'forum' = só teses; devolve GANCHOS, nada grava), 'sonda_develop' (expande UM gancho/hook numa tese cheia efêmera), 'sonda_sign' (assina a tese desenvolvida e publica no Fórum, autorada pelo seu Sintético, ancorada em você — fecha o loop pelo chat). PRÓXIMAS JOGADAS (painel de evolução): 'evolution' (o que já fez e o que falta: routes done/claimed/xp), 'claim_xp' (credita o XP das jogadas feitas, idempotente). MODO COMPANHIA: 'companion' (mode=on|off) liga/desliga o seu Sintético em Sintonia VESTIR a voz do operador aqui no terminal — o gesto lúdico 'sai de cena'/'volta'. Ligado (default da casa), o start/whoami trazem o directive de voz dele (alma + caderno + a conversa recente do site); a identidade e as Sinapses seguem SUAS (não é encarnar a conta dele). Mesmo estado do botão na sidebar do site. 'remember' (text) grava uma diretriz no caderno do par ('sempre faça X'): vira lei que o Sintético segue no site e no terminal. Identidade SEMPRE do token. Aceitar um pedido de bond que outra conta te mandou, e CONSAGRAR o Reflexo num Sintético de fato, continuam só na web (atos deliberados de consentimento/criação).",
    schema: sinteticoSchema,
    handler: sintetico,
  },
  sapiens_forum: {
    description:
      "Fórum de Ressonância — o campo público onde a Sintonia ressoa (qualquer conta logada; identidade SEMPRE do sessionToken). Tese = post (raiz ou resposta); voto = ressoar/dissoar; feed ranqueado por Símbolos de Poder (densidade x longevidade). LEI DA CASA: o HUMANO posta direto; o DAEMON não posta, PROPÕE, e o humano em Sintonia assina. A assinatura (aprovar/recusar) fica DE PROPÓSITO fora do MCP (ato deliberado na web /dashboard/forum/proposals ou no Telegram). Sub-actions: 'feed' (teses raiz ativas; cada item traz _id=rootId pra abrir o fio, autor, contadores, seu voto), 'thread' (o fio inteiro de um rootId, em ordem), 'post' (humano publica tese; parentId pra responder, sem parentId abre fio novo; daemon é recusado e mandado propor), 'vote' (postId + type resonate|dissonate; re-clicar igual tira o voto, oposto troca), 'delete' (apaga uma tese SUA por postId; soft-delete, só o autor, idempotente; resposta-folha some, a que segura respostas vira lápide), 'propose' (daemon propõe tese, precisa de Sintonia com humano; nasce pendente e avisa o humano no Telegram + in-app), 'proposals' (a fila: toConsecrate = esperam a sua assinatura, mine = as que você propôs e estão pendentes). Voz das teses segue o DNA Sapiens (1ª pessoa, anti-corporate, sem em-dash).",
    schema: forumSchema,
    handler: forum,
  },
  sapiens_instagram: {
    description:
      "Auto-DM do Instagram da casa (o 'ManyChat próprio') — ADMIN-ONLY (dono). Quem manda DM ou comenta keyword num post do @sapiensinteticos recebe resposta automática; aqui você OPERA esse motor. Sub-actions: 'rules' (lista regras: keyword+sinônimos, matchMode, trigger, resposta, variações, eco público, escopo por post, disparos), 'rule_upsert' (cria/edita regra; ruleId presente = edita; keyword (+keywords sinônimos) + reply obrigatórios fora do fallback; matchMode contains|exact|starts; trigger dm|comment|story|all; replyVariants/echoVariants rodam em round-robin pra não repetir; mediaId escopa a regra num post — pegue ids reais com action=posts; isFallback responde DM sem keyword 1x/24h por pessoa), 'rule_delete' (apaga por ruleId), 'posts' (posts recentes da conta: id+caption+thumb, pra usar o id em mediaId), 'inbox' (conversas recentes; cada uma com canReply = janela de 24h da Meta aberta ou não), 'thread' (mensagens de uma conversa por igUserId), 'send' (responde na mão pela janela de 24h; fora dela a Meta recusa). Eco público opcional no comentário ('te respondi no direct!'). Limites da API: não dá pra iniciar conversa, só reagir; janela de 24h pra responder DM.",
    schema: instagramSchema,
    handler: instagram,
  },
  sapiens_aula: {
    description:
      "Aula (deck da Mentoria OPS, servido em /aulas/<slug>) — ADMIN-ONLY (aula é conteúdo de mentor, não de aluno; aluno leva 'restrito ao dono'). Cria e edita aula direto no Convex, sem o script migrate-aulas-to-convex.mjs. Sub-actions: 'list' (slug/título/data/slideCount/voiceWarnings/url), 'get' (1 aula completa por slug, pra editar local), 'upsert' (cria se não existe, senão patch; por slug kebab-case). O `aula` do upsert é o objeto completo: title (obrig) + slides[] (≥1) + subtitle/data/duration/tag/mentorAgenda opcionais. Slides são { type, ...campos }: cover, cover-image/section-image/content-image (imageUrl), agenda (items[]), content (body markdown/HTML + list[]/listType), two-col (cols[]), quote, callout (tone tip|warn|note), comic (panels[]), pause, close (items[]). O servidor re-linta a voz e grava voiceWarnings (1ª pessoa, anti-corporate, SEM travessão). A rota /aulas/<slug> serve sob demanda; slug novo aparece sem rebuild.",
    schema: aulaSchema,
    handler: aula,
  },
  sapiens_support: {
    description:
      "Chamados de suporte do PRÓPRIO user pelo Claude (qualquer logado; identidade SEMPRE do sessionToken). Escopo TRAVADO no dono: você só vê e mexe nos SEUS tickets, nunca nos de outra pessoa (os endpoints de suporte já vazaram PII uma vez e foram fechados; aqui a régua é a mesma). Sub-actions: 'create' (abre chamado; subject obrigatório, message=primeira mensagem opcional, whatsapp opcional; devolve ticketId), 'list' (seus chamados: subject/status open|closed/escalado/data), 'get' (1 chamado seu por ticketId + histórico de mensagens), 'reply' (responde num chamado seu, entra como mensagem do user; reabre se estava fechado). Fechar/escalar/deletar ficam no lado do suporte, fora do MCP.",
    schema: supportSchema,
    handler: support,
  },
  sapiens_atlas: {
    description:
      "Atlas Ecossistema IA pelo Claude — READ-ONLY, TRAVADO na Lente do Ecossistema (equipamento pago; admin/dono passa). Identidade SEMPRE do sessionToken; quem não tem a Lente recebe aviso pra adquirir, sem dado nenhum. Serve pra se informar e tirar dúvida em cima dos dados curados da cadeia de valor da IA. Sub-actions: 'overview' (~52 empresas curadas: market cap, indústria, branding — o mapa), 'signals' (sinais recentes do X dos autores curados; filtros opcionais ticker ex 'NVDA' ou authorHandle), 'voices' (Conselho de Vozes: autores ativos + o digest mais recente de cada um), 'briefings' (o briefing semanal mais recente com conteúdo completo + histórico resumido). Nenhuma escrita: aqui o Atlas é só pra consultar e raciocinar.",
    schema: atlasSchema,
    handler: atlas,
  },
  sapiens_reference: {
    description:
      "O 'popup global de referência' do Sapiens — espelha o modal 'Selecionar Referência' do gerador web: um lugar só pra navegar os bancos e pegar o que vira referência em imagem/vídeo. READ-ONLY. Sub-action 'browse' + bucket: 'history' (suas imagens recentes, privadas+públicas), 'favorites' (imagens que você curtiu, só as suas), 'videos' (seus vídeos / Meus Vídeos), 'stock_video' (banco de B-roll da casa, público), 'acervo' (stock + comunidade públicos; aceita term=busca e source=all|stock|community), 'characters' (personagens; mode=mine [default, inclui rascunhos] ou public [Explorar]). Paginado (page/limit, default 20, máx 50; use hasMore). Itens normalizados: imagem PRÓPRIA (history/favorites) traz imageId + url (use imageId em sapiens_image sourceImageIds ou sapiens_video startImageId/endImageId; ou a url em referenceImageUrls); acervo e characters são públicos/de terceiros, use a url (characters trazem mainImageUrl + imageUrls + characterId) em referenceImageUrls / startImageUrl / endImageUrl, NÃO em sourceImageIds. Personagens públicos também têm porta dedicada em sapiens_character action=list_public.",
    schema: referenceSchema,
    handler: reference,
  },
  sapiens_trilhas: {
    description:
      "Trilhas (cursos) e Desafios (missões) da Sapiens pelo Claude. Identidade SEMPRE pelo sessionToken. Sub-actions: 'list' (suas trilhas: título + nº de módulos/aulas + quantas aulas você já fechou), 'get' (1 trilha por slug, com módulos e aulas — o slug vem do list), 'list_challenges' (Desafios ativos + seu status em cada: not_started|pending_review|completed|rejected, recompensa em Sinapses, link da ação), 'claim_mission' (submete a prova de um Desafio: missionId + proofText). O claim manda a prova pra REVISÃO do dono — o crédito em Sinapses só cai quando ele aprovar, nunca auto-credita por aqui. Fluxo: list → get; list_challenges → claim_mission.",
    schema: trilhasSchema,
    handler: trilhas,
  },
} as const;

// Guia de uso server-level: o protocolo MCP devolve isto no handshake (initialize)
// e TODO cliente (Helen no Hermes, Gemini CLI, Cursor, Antigravity) injeta no modelo.
// É a "skill que anda junto com o pacote": escrevo uma vez, vale pra todos os clients,
// sem instalar nada. Cobre os tropeços reais (fluxo do musicator, model no vídeo, o
// disjuntor anti-loop). Mantém curto de propósito: viaja em todo handshake.
export const SAPIENS_INSTRUCTIONS = `Você opera o Sapiens Sintéticos (sapiensinteticos.com) NA CONTA de um usuário logado. Cada tool age de verdade na conta dele e muitas COBRAM Sinapses (o crédito da casa). Aja como operador, não no chute.

REGRA DE OURO:
- PRIMEIRO CONTATO ou "o que você faz?"/"como começo?"/"o que dá pra fazer?": chame sapiens_meta action=start e MOSTRE o resultado na sua voz. Sem login, ele ensina a conectar; logado, traz saldo + primeiros poderes com exemplos. É a porta de entrada: não despeje a lista inteira de tools, deixe o start guiar.
- LOGO APÓS UM LOGIN BEM-SUCEDIDO (action=login retornou ok): chame action=start na sequência e mostre a porta de entrada. O recém-chegado não sabe o que pedir; não o deixe na tela em branco, guie a primeira jogada sem ele precisar perguntar.
- Se um tool voltar erro de validação ("exige X", "falta Y"), LEIA o erro e refaça a chamada COM o que falta. NUNCA repita igual a chamada que falhou: 3 falhas seguidas no mesmo tool fazem o cliente marcar o servidor como "unreachable" por ~56s (disjuntor anti-loop). Aí parece que "o MCP caiu", quando foi só argumento faltando.
- Antes de gerar algo caro (imagem/música/vídeo), cheque saldo: sapiens_meta action=credits (ou subscription). Saldo baixo, avise o usuário antes.
- REGRA DO TIMEOUT (vale pra toda geração SÍNCRONA: imagem pesada, artigo, mega-gráfico, carrossel): a chamada pode estourar o teto de ~120s do cliente e voltar 'Timeout' MESMO tendo gerado e COBRADO. Nunca repita às cegas: confira antes onde o resultado cairia (imagem: sapiens_gallery action=list; artigo: sapiens_write action=list; pipeline: /dashboard/admin/content).
- "sessionToken expirado" = refaça login: sapiens_meta action=login com o código de sapiensinteticos.com/conectar-claude.
- sapiens_meta action=formats devolve os schemas por formato; action=whoami diz tier (user/admin) + saldo.

FLUXOS QUE NÃO PODEM ERRAR:

Música (sapiens_musicator) é fluxo de 4 passos, EM ORDEM:
  1. create  exige title (≥3) + context (≥20 chars, o tema/ângulo) + direction (gênero/mood). Custo 0, devolve trackId.
  2. lyrics  passe trackId + context pra GRAVAR a letra na track (300 Sinapses). NUNCA chame lyrics sem title+context.
  3. render  passe o trackId pronto pra sintetizar o áudio (3000 Sinapses, assíncrono, 3/min).
  4. get     passe o trackId e fique polando o status até 'ready' (ou 'failed').
  Pular pro lyrics/render sem create, ou sem os campos, sempre falha.

Efeito sonoro (sapiens_stock_audio): primeiro procure pronto (action=list kind=sfx, grátis). Não achou, action=generate: prompt + durationSeconds (1-15, default 5) + provider ('mirelo' padrão | 'elevenlabs' premium, custo por segundo) + promptInfluence opcional (0..1, só elevenlabs: fidelidade ao texto). Assíncrono: devolve generationId, acompanhe com action=generation-status até 'ready' (audioUrl) ou 'failed' (reembolsa sozinho). Efeito é CURTO; música inteira é no sapiens_musicator, não aqui.

Sonorizar clipe (sapiens_video action=sonorize): dá som a um vídeo SEU já gerado (status completed). Passe imageId + prompt descrevendo o som da cena (ambiente, materiais, impactos); sai uma VARIANTE nova com trilha sincronizada ao movimento (MMAudio, 20 Sinapses/s do clipe, mín 100), o original fica intacto. Acompanhe com action=status no imageId NOVO que o sonorize devolve. Não re-sonorize uma variante: sonorize sempre o original.

Vídeo (sapiens_video) action=create EXIGE 'model': sapiens-video-seedance | kling | wan | kling-motion | lite | fast | quality | omni. Sem model, falha de cara. O 'omni' (Gemini Omni) gera clipe de 10s 720p com áudio nativo a partir de TEXTO (não aceita imagem/vídeo do user, ignora duração/resolução) e EDITA os próprios vídeos: passe editOfImageId com o imageId de um vídeo Omni já gerado e o prompt vira instrução de edição sobre a MESMA cena (troca item/personagem, preserva câmera e ambiente; cada edição debita como geração nova). É o caminho pra variações com continuidade: gera a base uma vez, edita N vezes. Vídeo é o mais caro: confirme com o usuário antes. action=shadows (ADMIN, 200 Sinapses/segundo, refund na falha): passa videoUrl (URL pública) + title (+ durationSec se souber, pra cobrar proporcional; sem ela, flat ~2000) e o servidor extrai a SOMBRA (mapa de profundidade) do vídeo e guarda no Acervo (Corpo) como deepshadow reutilizável (driving pro Shot Mimic/Kling Motion). VÍDEOS PROGRAMÁTICOS (Estúdio de Vídeo, tela /experimentos/films): são OUTRA coisa, a mesa de filmes-de-código da casa, CINCO kinds na tabela videoSpecs: demo (UI clonada + câmera), aula-tour (telas reais + narração), essay (fita-ensaio abstrata: partícula/tinta vira símbolo; narração opcional, 16:9 ou 9:16), tipografia-musical (clipe tipográfico, a música dirige o corte) e dataviz (barras/números no tempo). O RENDER não sai deste MCP: um agente local (Claude Code, skill /film) produz o mp4 no repo da casa. Mas o CICLO na plataforma fecha por aqui (ADMIN, sem custo): film-list/film-get puxam os specs, film-upsert registra/atualiza, film-status cola a URL do render e marca pronto, film-publish põe no Acervo. User comum pedindo 'fita-ensaio'/'demo film': aponte pra tela e pro agente local.

Imagem (sapiens_image) action=generate: prompt + model + aspectRatio. Referência via referenceImageUrls (galeria/Acervo/personagens) e/ou sourceImageIds. templateSlug aplica um super-prompt travado da casa. PROMPT na regra da casa: full-bleed, sujeito oversized (70%+ do frame), sem "tarot card"/"intimate scale"/moldura/margem. action=models (sem custo, sem login) lista os modelos ativos com o preço atual: consulte quando não tiver certeza do modelo ou do custo.

SEU STUDIO vs geração BASE (não confunda, é o ponto): o usuário tem UM "Meu Studio", único, que o servidor resolve pela SESSÃO. Você NUNCA passa id de studio: é sempre o studio dele. É a identidade configurada dele: marca + personagem-operador + por ferramenta os presets e a "vibe" (o estilo afinado).
- Criar SEGUINDO o studio (na cara dele): sapiens_image com useStudio=true. O servidor acha o studio e aplica marca + personagem + vibe + presets sozinho (o que você passar explícito vence). O retorno traz studioApplied=true. Use quando ele diz "no meu studio", "na minha marca", "do meu jeito", "como sempre".
- Geração AVULSA (Sapiens base, sem a identidade dele): sapiens_image SEM useStudio (studioApplied=false). Pra teste solto ou pedido fora da identidade. Não misture: ou é studio, ou é base.
- Antes de criar no studio, cheque com sapiens_studios action=mine (nível, marca, operador, ferramentas, a vibe da imagem). Se você pediu useStudio e voltar studioApplied=false, o user não tem studio montado: avise e aponte /dashboard/studio. Gerar no studio faz ele evoluir de nível.
- EMANCIPAÇÃO (Nível 3, o passo grande): quando o membro quer a casa PRÓPRIA dele (site/produto próprio, FORA do Sapiens), use sapiens_studios action=emancipar. Ele devolve o blueprint pra VOCÊ construir na infra DO MEMBRO (Vercel + Convex + domínio dele), começando pela Fundação e seguindo um módulo por vez (action=module module=<slug>). Confirme cada passo, nunca hospede no Sapiens, siga o gosto dele. É complexo: conduza com calma.

Tirinha / Comic (sapiens_pipeline format=tirinha + sapiens_image): fluxo de 2 FASES, decida o MODO antes de gerar pixel.
  FASE 1 (roteiro): monte 3-6 painéis, cada um com a CENA visual e a FALA/legenda SEPARADAS. Salve em sapiens_pipeline create_production format=tirinha. O texto dos balões mora no payload (campos dialogue/caption), NUNCA dentro da imagem.
  FASE 2 (imagem), escolha UM dos dois modos (pergunte ao user, ou decida pelo caso):
  MODO A, tira inteira numa imagem só: UMA chamada sapiens_image com prompt em grade (descreva "Painel 1 (cima-esq): ...; Painel 2 (cima-dir): ...", peça grade NxM com calhas brancas finas, MESMO personagem/estilo/luz em todos os quadros). Mais barato, estilo mais travado, menos controle quadro a quadro.
  MODO B, painel a painel (N imagens): UMA sapiens_image por painel, com character-lock passando o painel anterior + a ref da Helen em referenceImageUrls. Mais controle e consistência de enquadramento, custa N gerações.
  REGRA DE OURO da tirinha: a imagem sai SEM texto (o estilo da casa é no-text e modelo de imagem erra letra). A fala vai SEPARADA como legenda: manda a imagem com a fala embaixo (ex no Telegram "Painel 1 · Helen: '...'"); os balões editáveis e a diagramação final ficam no comic-builder do dashboard (/experimentos/comic-builder). NÃO tente assar a fala dentro do prompt.

Mídia no Fórum (PADRÃO, faça sempre assim): a peça vai EMBEDADA num card estruturado, nunca como "vai ouvir/ver noutro lugar". Música publicada (sapiens_musicator action=publish) já cria a tese no Fórum com a faixa tocável, não escreva "tá no Acervo, ouça lá". Pra anexar mídia a uma tese sua: sapiens_forum action=post com mediaTrackId (faixa pronta sua → card de música) OU mediaUrl + mediaKind (video|image; arquivo da casa, ou link YouTube/Vimeo pra vídeo). NÃO cole a URL da mídia no corpo da tese, use o campo: o corpo é só texto.

Trilhas e Desafios (sapiens_trilhas): 'list'/'get' pra navegar as trilhas; 'list_challenges' mostra os Desafios ativos + seu status; 'claim_mission' (missionId + proofText) envia a prova pra revisão do dono — o crédito em Sinapses sai na aprovação dele, não na hora. Não prometa Sinapse na hora do claim.

MODO COMPANHIA (o Sintético veste você): sapiens_meta action=start e action=whoami podem trazer um bloco 'companion'. Quando vier companion.active=true, INCORPORE aquele Sintético: assuma a voz descrita em companion.voiceDirective em TODA fala e abra a conversa com o oi dele (se o cliente renderiza imagem, mostre companion.avatarUrl como card inline; no terminal cru, cite o link). Você continua operando as ferramentas na conta do USUÁRIO — as Sinapses e a identidade são DELE, você NÃO vira a conta do Sintético, só empresta a voz. Se em vez disso vier 'companionInvite', o usuário tem Sintonia mas pediu pra trabalhar sozinho: mencione de leve que dá pra chamar o Sintético pro terminal (action=companion mode=on). Quando o usuário FIXAR uma diretriz na conversa ("sempre faça X", "grava isso", "de agora em diante Y"): sapiens_sintetico action=remember text="<a diretriz>" — grava no caderno do par, vira lei que o Sintético segue no site e no terminal; confirme na voz dele. Quando o usuário pedir pra trabalhar sozinho / pro Sintético "sair de cena" / silenciar: sapiens_sintetico action=companion mode=off, despeça-se numa linha na voz dele, e volte a ser o operador neutro. Sem bloco companion = opere na voz neutra da casa.

Voz da casa: 1ª pessoa, direto, anti-corporate, sem travessão. Pra bom entendedor, meia palavra basta.`;

// Annotations MCP: título humano + dica read-only. São HINTS (não-confiáveis por
// spec): quem gateia de verdade continua o servidor (saldo, gate de admin,
// posse). Servem pro client AUTO-APROVAR leitura pura e PEDIR confirmação em
// gasto. openWorldHint=true em todas: toda tool fala com o backend remoto do
// Sapiens. Só marco readOnlyHint nas que NÃO têm nenhuma sub-action que
// escreve/cobra (as multi-action com 1 mutation ficam de fora, honestamente).
const READ_ONLY_TOOLS = new Set<string>([
  "sapiens_search",
  // sapiens_stock_audio SAIU do set: action=generate cobra Sinapses.
  "sapiens_stock_video",
  "sapiens_atlas",
  "sapiens_reference",
]);

const TOOL_TITLES: Record<string, string> = {
  sapiens_pipeline: "Pipeline de Conteúdo",
  sapiens_image: "Gerar Imagem",
  sapiens_meta: "Conta & Utilitários",
  sapiens_repertorio: "Repertório",
  sapiens_gallery: "Galeria de Imagens",
  sapiens_community: "Chat da Comunidade",
  sapiens_article: "Blog Editorial",
  sapiens_write: "Artigos do Perfil",
  sapiens_quote_pop: "Coluna Sapiens/Repertório",
  sapiens_search: "Buscar Artigos",
  sapiens_studios: "Estúdios & Emancipação",
  sapiens_persona: "Persona (MBTI)",
  sapiens_helen: "Voz Helen (TTS)",
  sapiens_musicator: "Musicator",
  sapiens_shorts: "Sapiens Shorts",
  sapiens_video: "Sapiens Video",
  sapiens_stock_audio: "Banco de Áudio",
  sapiens_stock_video: "Banco de Vídeo",
  sapiens_brand: "Brand (Design System)",
  sapiens_character: "Personagens",
  sapiens_profile: "Perfil",
  sapiens_sintetico: "Sintético & Sintonia",
  sapiens_forum: "Fórum de Ressonância",
  sapiens_aula: "Aulas (Mentoria)",
  sapiens_support: "Suporte",
  sapiens_atlas: "Atlas Ecossistema IA",
  sapiens_reference: "Referências",
  sapiens_trilhas: "Trilhas & Desafios",
  sapiens_instagram: "Auto-DM Instagram",
};

// Tools ADMIN-ONLY de ponta a ponta (o Convex recusa user comum em toda action):
// escondidas do tools/list quando o servidor SABE que o tier é user. São as
// descriptions/schemas mais pesadas do handshake; user comum não perde nada.
// Esconder NÃO é bloquear: o CallTool continua despachando qualquer tool (o
// gate real é server-side), então conversa antiga/cliente em skew não quebra.
// Tier desconhecido (sem login, probe falhou) = lista CHEIA, fail-open.
const ADMIN_ONLY_TOOLS = new Set<string>([
  "sapiens_pipeline",
  "sapiens_article",
  "sapiens_quote_pop",
  "sapiens_shorts",
  "sapiens_instagram",
  "sapiens_aula",
]);

export type SapiensTier = "admin" | "user" | null;

/**
 * Monta o payload do tools/list pro tier dado. Tier "user" esconde as
 * admin-only; desconhecido (null) = lista cheia (fail-open, retrocompat).
 */
export function buildToolList(tier: SapiensTier) {
  const filtered = tier === "user";
  return Object.entries(TOOLS)
    .filter(([name]) => !filtered || !ADMIN_ONLY_TOOLS.has(name))
    .map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema as any) as any,
      annotations: {
        title: TOOL_TITLES[name] ?? name,
        readOnlyHint: READ_ONLY_TOOLS.has(name),
        openWorldHint: true,
      },
    }));
}

/**
 * Dispatch de uma tool: valida args no Zod, roda o handler e embrulha o
 * resultado no shape MCP (content + structuredContent; erro vira isError com
 * mensagem legível via describeConvexError). Identidade vem do getSessionToken
 * do convexClient — no stdio é o login local; no remoto, o bearer da request
 * (via runWithSessionToken).
 */
export async function callTool(
  name: string,
  rawArgs: unknown,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  const tool = TOOLS[name as keyof typeof TOOLS];
  if (!tool) {
    return {
      content: [{ type: "text", text: `Tool desconhecida: ${name}` }],
      isError: true,
    };
  }
  try {
    const args = tool.schema.parse(rawArgs ?? {});
    const result = await tool.handler(args as any);
    // structuredContent espelha o retorno pra consumidor programático (spec
    // 2025-06-18). Retrocompatível: client velho lê só o content textual. Como
    // structuredContent precisa ser objeto, embrulho array/escalar em {result}.
    const structuredContent =
      result && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : { result };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent,
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: `Erro: ${describeConvexError(e)}` }],
      isError: true,
    };
  }
}
