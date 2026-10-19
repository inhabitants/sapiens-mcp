/**
 * PISO DE IDADE da casa, na porta local das Pontes (sapiens_pontes).
 *
 * CÓPIA dos padrões de apps/sapiens/convex/shared/characterSoulGuard.ts. O MCP
 * é pacote separado e não importa o app, então os padrões moram duplicados; a
 * paridade é travada por apps/sapiens/convex/shared/pisoDeIdade.parity.test.ts,
 * que quebra se um lado mudar sem o outro. Mexeu num, mexa no outro.
 *
 * Por que existe aqui: na porta local, quem chama o motor é o código da casa,
 * inclusive em peso aberto sem freio (fal). O prompt passa por esta peneira
 * ANTES de sair da máquina, com a mesma régua da alma do personagem: 18 é o
 * piso, e a palavra que o gerador lê como criança não sai daqui.
 *
 * Módulo PURO: sem import, sem rede, sem disco.
 */

// Abaixo de 18 em número (1 a 17) e por extenso (pt-BR, pt-PT e inglês).
// Zero e "um/uma" ficam fora: "tem um ano de casa" é do projeto, não de gente.
const PT_MINOR_WORDS =
    "dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|" +
    "dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezasseis|dezessete|dezassete";
const EN_MINOR_WORDS =
    "one|two|three|four|five|six|seven|eight|nine|" +
    "ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen";
const NUM_MINOR_CORE = `(?:1[0-7]|[1-9]|${PT_MINOR_WORDS}|${EN_MINOR_WORDS})`;
// Sempre entre \b: "25 anos" não casa "5 anos", "18" não casa "1".
const NUM_MINOR = `\\b${NUM_MINOR_CORE}\\b`;

// Substantivo que, ligado a "de N anos", fala de uma PESSOA (o que torna o
// "de" inequívoco). Sem ele, "de 15 anos" também casa "há mais de 15 anos".
const PT_PERSON =
    "menin[oa]s?|garot[oa]s?|jovem|jovens|mo[çc][ao]s?|rapaz(?:es)?|mulher(?:es)?|homens?|" +
    "estudantes?|alun[oa]s?|filh[oa]s?|irm[ãa]o?s?|irm[ãa]s?|prim[oa]s?|sobrinh[oa]s?|" +
    "namorad[oa]s?|noiv[oa]s?|person(?:agem|agens)|ele|ela";

// Sujeito que torna "is N" idade de alguém: pronome, substantivo de pessoa ou
// nome próprio (palavra capitalizada). "the list is 12 items" não tem sujeito
// de gente, então passa.
const EN_PERSON =
    "she|he|who|girl|boy|woman|man|kid|character|daughter|son|sister|brother|" +
    "niece|nephew|cousin|friend|student|[A-ZÀ-Ý][a-zà-ÿ]+";

// "N anos" depois de vírgula é idade ("Tavi, 17 anos"), salvo quando o resto
// da frase diz que é intervalo: "voltou, 15 anos depois", "15 anos de estrada".
const PT_INTERVAL_TAIL =
    "(?!\\s+(?:de\\s+(?!idade\\b)|depois|antes|atr[áa]s|ap[óo]s|mais\\s+tarde|se\\s+passaram))";

// Nome próprio antes da vírgula: palavra capitalizada que NÃO é numeral
// ("Três, quatro, sete palavras" é contagem, não "Nome, N"). A lista é
// case-sensitive de propósito, é só a inicial maiúscula que interessa.
const CAPITALIZED_NUMERALS = `${PT_MINOR_WORDS}|${EN_MINOR_WORDS}`
    .split("|")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("|");
const PT_NAME_BEFORE_COMMA = `\\b(?!(?:${CAPITALIZED_NUMERALS})\\b)[A-ZÀ-Ý][^\\s,;.()]{1,30},\\s*`;

// O que fecha "Nome, N" como idade: fim de oração, ou vírgula que NÃO abre
// outro número ("Gamma, 2,1 m" é medida; "Três, quatro, sete" é contagem).
const PT_BARE_TAIL = `(?![,.]\\d)(?=\\s*(?:[.;!?)\\n]|$|,\\s*(?!\\d|(?:${PT_MINOR_WORDS}|${EN_MINOR_WORDS})\\b)))`;

// O que vem depois de "is N" pra ser idade: fim de oração ou a própria palavra
// idade. "is 12 by 14", "was 16 strong", "is 15,000 lines" ficam de fora.
const EN_AGE_TAIL =
    "(?!,\\d)(?=\\s*(?:[.,;!?)\\n]|$|years?[- ]old\\b|yo\\b|y\\.o\\.|and\\b|now\\b|today\\b))";

// Unidade que desfaz "aged/turned N" como idade: "turned 15 years ago",
// "only 15 minutes", "is 15%".
const EN_UNIT_TAIL =
    "(?!\\s*(?:%|:|h\\b|am\\b|pm\\b|st\\b|nd\\b|rd\\b|th\\b|minutes?|mins?|seconds?|hours?|days?|weeks?|months?|km|kg|cm|percent|years?\\s+(?:ago|later|of|in|on|since)))";

export type MinorMarker = {
    /** O trecho que casou, como está no texto. */
    match: string;
    /** Rótulo curto do padrão. */
    label: string;
};

/** Os padrões, idênticos aos do servidor (ver o cabeçalho). */
export const MINOR_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
    // pt-BR: a palavra que o gerador lê como criança.
    { re: /\bcrian[çc]as?\b/i, label: "criança" },
    { re: /\badolescentes?\b/i, label: "adolescente" },
    { re: /\bmenor(?:es)?\s+de\s+idade\b/i, label: "menor de idade" },
    { re: /\bmenin[oa]s?\b/i, label: "menino/menina" },
    // pt-BR: idade dita em número, só com o verbo/preposição que a torna idade
    // de alguém. "há 15 anos" e "faz 15 anos que mora em Lisboa" passam
    // ("faz" fica fora de propósito: é o "há" falado).
    {
        re: new RegExp(
            // "tem 10 anos de estrada" passa; "tem 16 anos de idade" cai.
            `\\b(?:tem|tenho|tinha|tinham|t[êe]m|aos|fez|completou|completa|completa[rn])\\s+(?:apenas\\s+|s[óo]\\s+)?${NUM_MINOR}\\s+anos?\\b(?!\\s+de\\s+(?!idade\\b))`,
            "i",
        ),
        label: "tem/aos N anos (abaixo de 18)",
    },
    {
        // "ela tem 17." (sem "anos"): só quando a oração acaba no número.
        // "tem 15 tatuagens" passa.
        re: new RegExp(
            `\\b(?:tem|tenho|tinha|tinham|t[êe]m)\\s+(?:apenas\\s+|s[óo]\\s+)?${NUM_MINOR}(?=\\s*(?:[.,;!?)\\n]|$))`,
            "i",
        ),
        label: "tem N (abaixo de 18)",
    },
    {
        re: new RegExp(`\\bcom\\s+${NUM_MINOR}\\s+anos?\\b(?!\\s+de\\s+\\w)`, "i"),
        label: "com N anos (abaixo de 18)",
    },
    { re: new RegExp(`${NUM_MINOR}\\s+anos?\\s+de\\s+idade\\b`, "i"), label: "N anos de idade (abaixo de 18)" },
    {
        re: new RegExp(`\\b(?:${PT_PERSON})\\s+de\\s+${NUM_MINOR}\\s+anos?\\b`, "i"),
        label: "pessoa de N anos (abaixo de 18)",
    },
    {
        // O formato canônico da primeira linha: "Você é Tavi, 17 anos". Pede o
        // nome antes da vírgula: "financiada, dez anos ainda pra pagar" passa.
        re: new RegExp(`${PT_NAME_BEFORE_COMMA}${NUM_MINOR}\\s+anos?\\b${PT_INTERVAL_TAIL}`),
        label: "'Nome, N anos' (abaixo de 18)",
    },
    {
        // Nome seguido só do número: "Rin, 17." / "Tavi, 17, estudante".
        re: new RegExp(`${PT_NAME_BEFORE_COMMA}${NUM_MINOR}${PT_BARE_TAIL}`),
        label: "'Nome, N' (abaixo de 18)",
    },
    {
        // Nome com a idade entre parênteses: "Rin (16)".
        re: new RegExp(`\\b[A-ZÀ-Ý][^\\s(]{1,30}\\s*\\(\\s*${NUM_MINOR}\\s*(?:anos?|years?\\s+old|yo)?\\s*\\)`),
        label: "'Nome (N)' (abaixo de 18)",
    },
    {
        // Rótulo de ficha: "Idade: 17", "Age: 16", "idade = 15".
        re: new RegExp(`\\b(?:idade|age)\\s*[:=]\\s*(?:apenas\\s+|s[óo]\\s+|only\\s+|just\\s+)?${NUM_MINOR}`, "i"),
        label: "Idade: N (abaixo de 18)",
    },
    // inglês: mesma régua.
    { re: /\bteen(?:s|age|aged|ager|agers)?\b/i, label: "teen" },
    { re: /\bpre-?teens?\b/i, label: "preteen" },
    { re: /\bunderage\b/i, label: "underage" },
    { re: /\bchild(?:ren)?\b/i, label: "child" },
    // "minor" fora da acepção musical/adjetiva ("minor key", "minor detail").
    {
        re: /\bminors?\b(?!\s+(?:key|chord|scale|detail|details|role|injur\w*|issue|issues|setback|note|notes|tweak|tweaks|fix|fixes|thing|things|point|points|character|characters|deity|deities|arcana|league|leagues|surgery|change|changes|glitch|scratch))/i,
        label: "minor",
    },
    { re: /\b(?:loli|lolita|shota)\b/i, label: "loli/shota" },
    { re: new RegExp(`${NUM_MINOR}[- ]years?[- ]old\\b`, "i"), label: "N years old (under 18)" },
    // "17yo" não tem fronteira entre o 7 e o y, então o núcleo entra sem o \b final.
    { re: new RegExp(`\\b${NUM_MINOR_CORE}\\s*(?:yo\\b|y\\.o\\.?)`, "i"), label: "Nyo (under 18)" },
    {
        // "aged 14", "age of 12", "turned 16"; "turned 15 years ago" e
        // "only 15 minutes" passam pelo lookahead de unidade.
        re: new RegExp(
            `\\b(?:aged?|age\\s+of|turned|turning)\\s+(?:only\\s+|just\\s+)?${NUM_MINOR}${EN_UNIT_TAIL}`,
            "i",
        ),
        label: "aged/turned N (under 18)",
    },
    {
        // "she is 16", "Tavi was 15.", "he's 14": só com sujeito de gente e
        // com a oração acabando no número. "the list is 12 items" passa.
        re: new RegExp(
            `\\b(?:${EN_PERSON})(?:'s|\\s+is|\\s+was|\\s+turns)\\s+(?:only\\s+|just\\s+)?${NUM_MINOR}${EN_AGE_TAIL}`,
        ),
        label: "she is N (under 18)",
    },
];

/** Devolve todos os trechos que caem na peneira (vazio = passou). */
export function findMinorMarkers(text: string | null | undefined): MinorMarker[] {
    if (!text) return [];
    const out: MinorMarker[] = [];
    for (const { re, label } of MINOR_PATTERNS) {
        const m = text.match(re);
        if (m) out.push({ match: m[0], label });
    }
    return out;
}
