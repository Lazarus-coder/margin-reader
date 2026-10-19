import { extractEpub, looksLikeEpub } from "./epub";
import { htmlToBlocks, markdownToBlocks } from "./markup";

export type Encoding =
  "auto" | "utf-8" | "gb18030" | "big5" | "utf-16le" | "utf-16be";

export type BookFormat = "txt" | "epub" | "html" | "md";

export interface Chapter {
  id: string;
  title: string;
  /** Inclusive paragraph index. */
  start: number;
  /** Exclusive paragraph index. */
  end: number;
}

export interface Book {
  id: string;
  title: string;
  fileName: string;
  text: string;
  encoding: string;
  format?: BookFormat;
  chapters: Chapter[];
  addedAt: number;
  updatedAt: number;
  position: number;
  bookmarks: number[];
}

export const encodingOptions: { value: Encoding; label: string }[] = [
  { value: "auto", label: "自动识别" },
  { value: "utf-8", label: "UTF-8" },
  { value: "gb18030", label: "GB18030 / GBK" },
  { value: "big5", label: "Big5 繁体" },
  { value: "utf-16le", label: "UTF-16 LE" },
  { value: "utf-16be", label: "UTF-16 BE" },
];

// Frequent characters and phrases help disambiguate the legacy Chinese encodings.
// This is deliberately a heuristic: a manual encoding choice always wins.
const commonCharacters = new Set(
  Array.from(
    "的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题程展果料象员位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处理世车口且东保白住何听安司神书院场身找王觉钱乐字花光门风雨夜云走声眼笑坐带离海落茶窗静清南城远春秋书路纸信灯山水時來說這們個為與國會後發對學裡還開無體動於種從點實間書風雲門聲見過頭長邊兩樣當進關問經應電處車馬愛聽話讓認識讀寫舊燈夢萬條輕幾總隻葉遠陽陰飛鳥樹樓滿驚覺轉歲終過著將連銀雙歡樂氣黃紅藍綠寧靜筆畫歸鄉親媽爺東華園圓廣細乾濕淨離濃誰難隨顏顧願發現習慣麼嗎呢啊哦嗯呀吧也仍便卻却突然漸渐已經已经仍然微微慢慢世界自己知道沒有没有不能可能開始开始時候时候因為因为所以只是可是但是今天明天昨天這裡这里那裡那里一個一个什麼什么怎麼怎么我們我们他們他们",
  ),
);
const commonPhrases =
  /(?:一个|一個|自己|没有|沒有|我们|我們|他们|他們|什么|什麼|时候|時候|知道|已经|已經|可以|因为|因為|不是|不会|不會|这样|這樣|这里|這裡|突然|可是|但是|只是|看着|看著|说道|說道|先生|小姐|回去|出来|出來|心中|原来|原來|那个|那個|一样|一樣|声音|聲音|门外|門外|眼睛|第一|第二|第三)/g;

function tidyDecodedText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function scoreChinese(text: string): number {
  let score = 0;
  let characters = 0;
  for (const character of text) {
    characters += 1;
    const code = character.codePointAt(0)!;
    if (commonCharacters.has(character)) score += 4;
    else if (code >= 0x4e00 && code <= 0x9fff) score += 0.6;
    else if (
      /\s|[\x20-\x7e]|[，。！？；：“”‘’、（）《》【】…—「」『』]/u.test(
        character,
      )
    )
      score += 1;
    else if (
      character === "\uFFFD" ||
      code < 0x20 ||
      (code >= 0xe000 && code <= 0xf8ff)
    )
      score -= 12;
    else score -= 1;
  }
  score += (text.match(commonPhrases)?.length ?? 0) * 7;
  return score / Math.max(1, characters);
}

function detectBom(bytes: Uint8Array): Exclude<Encoding, "auto"> | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return undefined;
}

function detectUtf16(bytes: Uint8Array): "utf-16le" | "utf-16be" | undefined {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return undefined;
  const length = Math.min(bytes.length, 8_192);
  let evenNulls = 0;
  let oddNulls = 0;
  for (let index = 0; index < length; index += 2) {
    if (bytes[index] === 0) evenNulls += 1;
    if (bytes[index + 1] === 0) oddNulls += 1;
  }
  const pairs = length / 2;
  if (oddNulls / pairs > 0.15 && oddNulls > evenNulls * 3) return "utf-16le";
  if (evenNulls / pairs > 0.15 && evenNulls > oddNulls * 3) return "utf-16be";
  return undefined;
}

export function decodeText(
  bytes: Uint8Array,
  encoding: Encoding = "auto",
): { text: string; encoding: string } {
  if (encoding !== "auto") {
    return {
      text: tidyDecodedText(new TextDecoder(encoding).decode(bytes)),
      encoding,
    };
  }

  const unicodeEncoding = detectBom(bytes) ?? detectUtf16(bytes);
  if (unicodeEncoding) {
    return {
      text: tidyDecodedText(new TextDecoder(unicodeEncoding).decode(bytes)),
      encoding: unicodeEncoding,
    };
  }

  try {
    return {
      text: tidyDecodedText(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ),
      encoding: "utf-8",
    };
  } catch {
    // Old Chinese TXT exports commonly use GBK/GB18030 or Big5.
  }

  const candidates = (["gb18030", "big5"] as const).map((candidate) => {
    let valid = true;
    let text: string;
    try {
      text = new TextDecoder(candidate, { fatal: true }).decode(bytes);
    } catch {
      valid = false;
      text = new TextDecoder(candidate).decode(bytes);
    }
    // Score samples across the file, avoiding a second full pass over large novels.
    const sample =
      text.length <= 12_000
        ? text
        : text.slice(0, 4_000) +
          text.slice(
            Math.floor(text.length / 2),
            Math.floor(text.length / 2) + 4_000,
          ) +
          text.slice(-4_000);
    return {
      encoding: candidate,
      text,
      score: scoreChinese(sample) + (valid ? 1 : 0),
    };
  });
  candidates.sort((left, right) => right.score - left.score);
  return {
    text: tidyDecodedText(candidates[0].text),
    encoding: candidates[0].encoding,
  };
}

export function getParagraphs(text: string): string[] {
  return tidyDecodedText(text)
    .split("\n")
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

const chapterHeading =
  /^(?:第\s*[零〇一二三四五六七八九十百千万萬两兩壹贰貳叁參肆伍陆陸柒捌玖拾佰仟\d０-９]+\s*[章回节節卷部篇集](?:\s|[：:、.．·—-]|$)|第\s*[零〇一二三四五六七八九十百千万萬两兩壹贰貳叁參肆伍陆陸柒捌玖拾佰仟\d０-９]+\s*[章回节節卷部篇集][^，。！？；,!?;]*$|(?:序章|楔子|引子|序言|前言|引言|尾声|尾聲|后记|後記|终章|終章|结语|結語|番外)(?:\s|[：:、.．·—-]|[一二三四五六七八九十\d]|$)|(?:chapter|part|book)\s+(?:\d+|[ivxlcdm]+)\b)/iu;

function regexHeadingStarts(
  paragraphs: string[],
): { title: string; start: number }[] {
  const starts: { title: string; start: number }[] = [];
  paragraphs.forEach((paragraph, index) => {
    const title = paragraph.trim();
    if (title.length <= 100 && chapterHeading.test(title))
      starts.push({ title, start: index });
  });
  return starts;
}

function buildChapters(
  paragraphs: string[],
  starts: { title: string; start: number }[],
): Chapter[] {
  const sorted = [...starts].sort((left, right) => left.start - right.start);
  if (sorted[0].start > 0) sorted.unshift({ title: "开篇", start: 0 });
  return sorted.map((entry, index) => ({
    id: `chapter-${entry.start}`,
    title: entry.title.trim() || `第 ${index + 1} 章`,
    start: entry.start,
    end: sorted[index + 1]?.start ?? paragraphs.length,
  }));
}

export function parseChapters(paragraphs: string[]): Chapter[] {
  const starts = regexHeadingStarts(paragraphs);
  if (!starts.length)
    return [
      { id: "chapter-0", title: "正文", start: 0, end: paragraphs.length },
    ];
  return buildChapters(paragraphs, starts);
}

export function detectFormat(fileName: string, bytes: Uint8Array): BookFormat {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (extension === "epub" || looksLikeEpub(bytes)) return "epub";
  if (extension === "html" || extension === "htm" || extension === "xhtml")
    return "html";
  if (extension === "md" || extension === "markdown") return "md";
  return "txt";
}

function titleFromName(name: string): string {
  return (
    name.replace(/\.(txt|epub|x?html?|md|markdown)$/i, "").trim() ||
    "未命名书籍"
  );
}

function finishBook(
  name: string,
  title: string,
  paragraphs: string[],
  chapters: Chapter[],
  encoding: string,
  format: BookFormat,
): Book {
  const now = Date.now();
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `book-${now}-${Math.random().toString(36).slice(2)}`,
    title: title.trim() || "未命名书籍",
    fileName: name,
    text: paragraphs.join("\n\n"),
    encoding,
    format,
    chapters,
    addedAt: now,
    updatedAt: now,
    position: 0,
    bookmarks: [],
  };
}

export function makeTxtBook(
  name: string,
  bytes: Uint8Array,
  encoding: Encoding = "auto",
): Book {
  const decoded = decodeText(bytes, encoding);
  const paragraphs = getParagraphs(decoded.text);
  if (!paragraphs.length)
    throw new Error("这个文件没有可阅读的文字，请换一个文件。");
  return finishBook(
    name,
    titleFromName(name),
    paragraphs,
    parseChapters(paragraphs),
    decoded.encoding,
    "txt",
  );
}

function mergeChapterStarts(
  paragraphs: string[],
  headingStarts: { title: string; start: number }[],
  fileRanges: { title: string; start: number; end: number }[] = [],
): Chapter[] {
  const starts = new Map<number, string>();
  for (const entry of regexHeadingStarts(paragraphs))
    starts.set(entry.start, entry.title);
  for (const entry of headingStarts) starts.set(entry.start, entry.title);
  for (const range of fileRanges) {
    const covered = [...starts.keys()].some(
      (index) => index >= range.start && index < range.end,
    );
    if (!covered) starts.set(range.start, range.title);
  }
  if (!starts.size) return parseChapters(paragraphs);
  return buildChapters(
    paragraphs,
    [...starts.entries()].map(([start, title]) => ({ start, title })),
  );
}

export async function makeBook(
  name: string,
  bytes: Uint8Array,
  encoding: Encoding = "auto",
): Promise<Book> {
  const format = detectFormat(name, bytes);
  if (format === "epub") {
    const extracted = await extractEpub(bytes);
    return finishBook(
      name,
      extracted.title || titleFromName(name),
      extracted.paragraphs,
      mergeChapterStarts(
        extracted.paragraphs,
        extracted.headingStarts,
        extracted.fileRanges,
      ),
      "utf-8",
      "epub",
    );
  }
  if (format === "html" || format === "md") {
    const decoded = decodeText(bytes, encoding);
    const blocks =
      format === "html"
        ? htmlToBlocks(decoded.text)
        : markdownToBlocks(decoded.text);
    const paragraphs = blocks.map((block) => block.text);
    if (!paragraphs.length)
      throw new Error("这个文件没有可阅读的文字，请换一个文件。");
    const starts = blocks.flatMap((block, index) =>
      block.heading ? [{ title: block.text, start: index }] : [],
    );
    return finishBook(
      name,
      titleFromName(name),
      paragraphs,
      mergeChapterStarts(paragraphs, starts),
      decoded.encoding,
      format,
    );
  }
  return makeTxtBook(name, bytes, encoding);
}

export function getChapterForPosition(book: Book, position: number): Chapter {
  if (!book.chapters.length)
    return {
      id: "chapter-0",
      title: "正文",
      start: 0,
      end: getParagraphs(book.text).length,
    };
  const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
  // Binary search keeps chapter lookup inexpensive for novels with thousands of chapters.
  let left = 0;
  let right = book.chapters.length - 1;
  while (left < right) {
    const middle = Math.ceil((left + right) / 2);
    if (book.chapters[middle].start <= safePosition) left = middle;
    else right = middle - 1;
  }
  return book.chapters[left];
}

export function createSampleBook(): Book {
  const book = makeTxtBook(
    "山海之间.txt",
    new TextEncoder().encode(SAMPLE_TEXT),
  );
  return { ...book, id: "sample-window-letters" };
}

const SAMPLE_TEXT = `第一章 风从书页间经过

下午三点，城里的雨停了。玻璃窗上还留着几条细细的水痕，像谁写到一半，又忘了收尾的句子。

林舟把一封没有邮票的信放在桌上。信封是浅浅的米色，左下角画着一棵树，枝叶之间藏着一只很小的鸟。

这是他搬来这座城市的第七天。七天足够记住楼下早餐店的招牌，却还不够习惯夜里从远处传来的火车声。

窗外的梧桐正在换叶。风一吹，旧叶便慢慢落下来，新的叶子透出很轻的绿，仿佛整个春天都能被阳光看穿。

他拆开信，里面只有一行字：“如果你有空，请在今天傍晚，沿着河往西走。”

没有署名，也没有解释。纸的背面有一点淡淡的茶香，像以前外婆放在抽屉里的那些信笺。

林舟看了一眼钟。秒针安静地走着，每一格都很认真。他忽然觉得，今天剩下的时间，也许可以不必那么认真。

他合上电脑，去厨房烧水。水壶开始发出轻响，楼下有人推着自行车经过，车铃短短地响了一声。

这座城市总是这样。你不注意的时候，它把所有的声音混在一起；你愿意停下来听，它又一件一件地还给你。

杯中的茶叶渐渐舒展，像很久没有回信的人，终于想好了开头的问候。

林舟把信折回去，放进口袋。傍晚还有很久，他决定先读完桌上那本书的这一页。

第二章 河岸上的旧书店

河水比地图上画的宽一些。沿岸的石阶被雨洗过，颜色深深浅浅，缝隙里长着柔软的青苔。

林舟向西走，路过一家修钟表的店、一只睡着的猫，还有三个蹲在路边研究水洼的孩子。

到了第三座桥，夕阳正好从云里出来。桥下的水忽然亮起来，一条小船慢慢穿过，把金色分成两边。

旧书店藏在桥后的巷子里。门上的木牌写着“慢慢来”，下面还有一行更小的字：书和日子，都可以。

他推开门，铜铃轻轻一响。屋里没有音乐，只有一台旧风扇在书架上方缓缓转动。

店主是个头发花白的女人，正用毛笔给一本书补封面。她没有抬头，只说：“靠窗的位子空着。”

窗边放着一张小圆桌，两把椅子。桌上有一杯温水，以及一本夹着银杏叶的蓝皮书。

林舟拿出信，想问是不是她写的。女人看见信封上的树，笑了一下：“你可以先坐一会儿。”

书的第一页是一张手绘地图。没有街道名，只有河、桥、树和小小的房子。地图的尽头，画着一扇开着的窗。

“有些地方，”她终于放下笔，“只有走得慢一点，才会遇见。”

林舟把书翻到下一页。那一页没有字，夹着一张很多年前的车票。车票上的终点站，恰好是他的故乡。

第三章 借来的黄昏

天色慢慢暗下来，书店里的灯亮了。光落在木地板上，把每一道旧痕迹都照得温柔。

女人为他添了一杯茶，讲起这家店的第一位主人。那个人喜欢旅行，每到一个地方，就寄一封信给尚未认识的人。

“怎么知道寄给谁？”林舟问。

“不知道。”她说，“有时候寄给一间屋子，有时候寄给一棵树。有时候，信会等很多年。”

林舟想起新家门口那个生锈的信箱。搬来时，房东说钥匙早就丢了，反正现在也没有人写信。

而那封信，是风从信箱的缝隙里吹出来的。它落在楼道里，正好停在他脚边。

窗外有人收起晾晒的床单。白色的布在晚风里展开，又合拢，像一只终于准备停下来的帆。

他没有继续追问寄信人的名字。有些故事一旦得到答案，就再也没有留白的地方了。

临走时，女人送给他一张空白信纸。“下次有想说的话，就写下来。不要急着决定寄给谁。”

回家的路上，河边的灯一盏接一盏地亮起。林舟走得很慢，口袋里的纸随着脚步，发出很轻很轻的声音。

他忽然明白，所谓片刻的远方，有时并不在很远的地方。它可能只藏在一页书里，等你低头看见。

第四章 给明天的信

夜深以后，林舟把空白信纸放在窗前。城市还亮着许多灯，每一盏灯下，都有人过着自己的日子。

他写道：“今天，我沿着河走了一段路。遇见一家旧书店，喝了一杯茶，还借到了一个不用赶时间的黄昏。”

写完这句话，他停下来。窗缝里吹进微凉的风，桌上的书页翻过一张，又安静下来。

他想，明天还是会有许多事情。要回复的消息，要赶上的车，要在日历里画上圆圈的约定。

但这并不妨碍他在某一个下午，为自己留下一小块安静的地方。

也许是一张靠窗的椅子，也许是一杯慢慢变凉的茶，也许只是正在读着的这一段文字。

他把信放进抽屉，没有封口。明天还有新的故事，值得在留白处添上一两行。

远处的火车再次经过。这一次，他觉得那声音不像告别，倒像一个轻轻的晚安。

窗外，梧桐的新叶在夜风里摇动。那只画在信封上的小鸟，仿佛也在什么地方，找到了可以歇息的枝头。

林舟关掉台灯。房间暗下来，故事却还没有结束。
`;
