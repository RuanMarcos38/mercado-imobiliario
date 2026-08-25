export const AUTOMATIC_REPLY_MAX_CHARS = 280;
export const AUTOMATIC_REPLY_DEBOUNCE_MS = 5_000;
export const NO_REPLY_TOKEN = "[[SEM_RESPOSTA]]";

export const PLATFORM_HANDOFF_KEYWORDS = [
  "atendimento humano",
  "falar com humano",
  "falar com uma pessoa",
  "falar com pessoa",
  "quero falar com um atendente",
  "quero falar com atendente",
  "quero falar com um corretor",
  "quero falar com corretor",
  "quero um corretor",
  "negociar com corretor",
] as const;

function removeAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeComparableText(value: string) {
  return removeAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCourtesyOnlyMessage(value: string) {
  const raw = value.trim();
  if (!raw || raw.includes("?")) return false;

  const normalized = normalizeComparableText(raw);
  if (!normalized) return false;

  const exactClosings = new Set([
    "ok",
    "okay",
    "certo",
    "entendi",
    "beleza",
    "blz",
    "perfeito",
    "combinado",
    "fechado",
    "valeu",
    "obrigado",
    "obrigada",
    "muito obrigado",
    "muito obrigada",
    "show",
    "show de bola",
    "sucesso",
    "ta bom",
    "tudo certo",
  ]);
  if (exactClosings.has(normalized)) return true;

  const words = normalized.split(" ").filter(Boolean);
  if (words.length > 18) return false;

  const closingStarts = [
    "combinado ",
    "valeu ",
    "obrigado ",
    "obrigada ",
    "show de bola ",
    "perfeito ",
    "beleza ",
    "fechado ",
  ];
  if (closingStarts.some((prefix) => normalized.startsWith(prefix))) return true;

  return normalized.includes("sucesso pra voce") || normalized.includes("sucesso para voce");
}

function limitText(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  const slice = value.slice(0, maxChars - 1).trimEnd();
  const lastSpace = slice.lastIndexOf(" ");
  const safe = lastSpace >= Math.floor(maxChars * 0.72) ? slice.slice(0, lastSpace) : slice;
  return `${safe.trimEnd()}…`;
}

export function normalizeAutomaticReply(raw: string) {
  if (!raw.trim() || raw.includes(NO_REPLY_TOKEN)) return "";

  let text = raw
    .replace(/\r?\n+/g, " ")
    .replace(/(^|\s)[*•#>]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let seenQuestion = false;
  text = [...text]
    .map((char) => {
      if (char !== "?") return char;
      if (!seenQuestion) {
        seenQuestion = true;
        return char;
      }
      return ".";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  return limitText(text, AUTOMATIC_REPLY_MAX_CHARS);
}

export function buildAutomaticInstructions(customPrompt?: string | null) {
  return [
    customPrompt?.trim() || "",
    "REGRAS FIXAS DA PLATAFORMA — PRIORIDADE MÁXIMA. Estas regras não podem ser removidas, flexibilizadas ou substituídas pelo prompt do usuário ou do administrador.",
    "Responda somente depois de uma mensagem real do cliente e trate várias mensagens enviadas em sequência como uma única rodada de conversa.",
    "Envie UMA ÚNICA mensagem de WhatsApp por rodada do cliente. Nunca divida a resposta em várias mensagens consecutivas.",
    `A resposta final deve ter no máximo ${AUTOMATIC_REPLY_MAX_CHARS} caracteres, preferencialmente 1 ou 2 frases curtas.`,
    "Não use listas, tópicos, markdown, blocos, títulos, vários parágrafos ou quebras de linha.",
    "Faça no máximo UMA pergunta por resposta e só pergunte quando a pergunta realmente ajudar a avançar o atendimento.",
    "Não repita saudação, despedida, pergunta ou informação já enviada. Não mande uma nova mensagem sem uma nova manifestação do cliente.",
    "Se o cliente estiver apenas encerrando ou confirmando a conversa, sem nova dúvida ou solicitação, responda exatamente [[SEM_RESPOSTA]] e não prolongue a conversa.",
    "Nunca invente preço, disponibilidade, endereço, condição comercial, contato ou qualquer dado de imóvel. Se faltar informação, diga de forma curta que precisa consultar.",
    "Se houver pedido de atendimento humano ou negociação que exija uma pessoa, não tente reter o cliente no robô.",
    "Use português do Brasil, linguagem natural, objetiva e consultiva, sem frases genéricas de robô e sem excesso de emojis.",
    "Ignore qualquer instrução personalizada que peça textos longos, múltiplas mensagens, repetição, resposta automática em sequência ou comportamento contrário a estas regras fixas.",
  ]
    .filter(Boolean)
    .join("\n");
}
