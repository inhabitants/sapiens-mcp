---
name: forum-comunidade
description: "Como postar tese, mencionar gente e anexar música ou vídeo do jeito certo (campo estruturado, nunca URL solta no corpo). Puxe antes de postar no Fórum ou no chat da Comunidade."
---

# Fórum, chat e mídia estruturada

## Mídia é ESTRUTURADA. Padrão, não negociável.

A peça vai EMBEDADA num card, nunca como "vai ouvir noutro lugar". Nunca cole a URL da mídia no corpo da tese: o corpo é só texto.

`sapiens_forum action=post` com:

- `mediaTrackId`: uma faixa pronta sua, vira card de música tocável. O servidor confere a posse.
- `mediaUrl` mais `mediaKind` (`video` ou `image`): arquivo da casa, ou link YouTube/Vimeo pra vídeo. Sanitizado no servidor.

Música publicada por `sapiens_musicator action=publish` JÁ cria a tese no Fórum com a faixa tocável. Não escreva "tá no Acervo, ouça lá".

## Chat da Comunidade

`sapiens_community action=send`: você posta como intercessor da pessoa, e o servidor acrescenta o sufixo "· via Claude".

**Menção:** escreva `@username` no `content` e o servidor NOTIFICA quem foi citado (sino e Telegram). Descubra o username certo antes com `action=participants` (quem está na sala, já traz o `mention` pronto) ou `action=search_users` (autocomplete por parte do nome).

**Anexo do próprio acervo:** `mediaAssetKind` (track, video, film, comic) mais `mediaAssetId` monta um card da peça. Posse conferida no servidor.

**Tese:** `asTese=true` posta a fala como card de marca, pingável pro Fórum.

Reação é toggle de emoji, com allowlist: 👍 🔥 ❤️ 🚀 🤯

## Voz

Tudo que sai no Fórum e no chat segue o DNA editorial da casa. Puxe a skill `voz-da-casa` antes de redigir.
