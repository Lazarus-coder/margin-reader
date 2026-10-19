export interface Block {
  text: string;
  heading: boolean;
}

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  sbquo: "‚",
  bdquo: "„",
  middot: "·",
  bull: "•",
  dagger: "†",
  permil: "‰",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  divide: "÷",
  plusmn: "±",
  frac12: "½",
  deg: "°",
  micro: "µ",
  para: "¶",
  sect: "§",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  ntilde: "ñ",
  szlig: "ß",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  phi: "φ",
  omega: "ω",
  Omega: "Ω",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) =>
      codePoint(Number.parseInt(hex, 16), match),
    )
    .replace(/&#(\d+);/g, (match, decimal: string) =>
      codePoint(Number.parseInt(decimal, 10), match),
    )
    .replace(
      /&([a-zA-Z][a-zA-Z0-9]*);/g,
      (match, name: string) => namedEntities[name] ?? match,
    );
}

function codePoint(value: number, fallback: string): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

const cjkClass =
  "\\u00b7\\u2000-\\u206f\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef";
const cjkBoundary = new RegExp(`[${cjkClass}]`, "u");

// Source files wrap CJK prose mid-sentence; those breaks must not become spaces.
const cjkLineWrap = new RegExp(
  `(?<=[${cjkClass}])[ \\t]*(?:\\r?\\n[ \\t]*)+(?=[${cjkClass}])`,
  "gu",
);

export function normalizeBlockText(text: string): string {
  return text
    .replace(/\u3000+/g, " ")
    .replace(cjkLineWrap, "")
    .replace(/[ \t\r\n\f\v\u00a0]+/g, " ")
    .trim();
}

const blockTags = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "header",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

/** Converts XHTML/HTML into ordered text blocks; no DOM APIs required. */
export function htmlToBlocks(html: string): Block[] {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<r[pt]\b[^>]*>[\s\S]*?<\/r[pt]\s*>/gi, "");
  const blocks: Block[] = [];
  let buffer = "";
  let heading = false;
  const flush = () => {
    const text = normalizeBlockText(decodeEntities(buffer));
    if (text) blocks.push({ text, heading });
    buffer = "";
  };
  const tagPattern = /<[^>]*>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(cleaned))) {
    buffer += cleaned.slice(cursor, match.index);
    cursor = tagPattern.lastIndex;
    const tag = match[0];
    const name =
      /^<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(tag)?.[1]?.toLowerCase() ?? "";
    const closing = /^<\s*\//.test(tag);
    if (name === "br" || name === "hr") {
      flush();
      continue;
    }
    if (/^h[1-6]$/.test(name)) {
      flush();
      heading = !closing;
      continue;
    }
    if (blockTags.has(name)) flush();
  }
  buffer += cleaned.slice(cursor);
  flush();
  return blocks;
}

function joinLines(left: string, right: string): string {
  const endsCjk = cjkBoundary.test(left.slice(-1));
  const startsCjk = cjkBoundary.test(right[0] ?? "");
  return left + (endsCjk || startsCjk ? "" : " ") + right;
}

function inlineToText(text: string): string {
  return decodeEntities(
    text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
      .replace(/`+([^`]*)`+/g, "$1")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/(?<![\w])_([^_\n]+?)_(?![\w])/g, "$1")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
      .replace(/<[^>]*>/g, ""),
  );
}

/** Converts Markdown into ordered text blocks, keeping headings detectable. */
export function markdownToBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let buffer = "";
  let inFence = false;
  const flush = () => {
    const text = normalizeBlockText(inlineToText(buffer));
    if (text) blocks.push({ text, heading: false });
    buffer = "";
  };
  const appendLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    buffer = buffer ? joinLines(buffer, trimmed) : trimmed;
  };
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      appendLine(line);
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flush();
      const text = normalizeBlockText(inlineToText(headingMatch[2]));
      if (text) blocks.push({ text, heading: true });
      continue;
    }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      flush();
      continue;
    }
    if (/^\s*>/.test(line)) {
      appendLine(line.replace(/^(?:\s*>\s?)+/, ""));
      continue;
    }
    const listItem = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      flush();
      const text = normalizeBlockText(inlineToText(listItem[1]));
      if (text) blocks.push({ text, heading: false });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    appendLine(line);
  }
  flush();
  return blocks;
}
