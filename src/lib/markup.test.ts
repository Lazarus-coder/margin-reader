import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToBlocks, markdownToBlocks } from "./markup";

describe("HTML to blocks", () => {
  it("turns headings and paragraphs into ordered blocks", () => {
    const blocks = htmlToBlocks(
      "<h1>第一章 春风</h1><p>第一段。</p><p>第二段。</p>",
    );
    expect(blocks).toEqual([
      { text: "第一章 春风", heading: true },
      { text: "第一段。", heading: false },
      { text: "第二段。", heading: false },
    ]);
  });

  it("splits on br, drops scripts and styles, and decodes entities", () => {
    const blocks = htmlToBlocks(
      "<head><title>t</title><style>.a{color:red}</style></head>" +
        "<body><p>甲&amp;乙</p>丙<br/>丁<script>var x = 1;</script>" +
        "<p> &#8220;引号&#8221; </p></body>",
    );
    expect(blocks.map((block) => block.text)).toEqual([
      "甲&乙",
      "丙",
      "丁",
      "“引号”",
    ]);
  });

  it("joins CJK lines wrapped in the source without adding spaces", () => {
    const blocks = htmlToBlocks(
      "<p>悟空\n挺身在傍，且不朝礼。</p><p>第一回　灵根育孕源流出</p>",
    );
    expect(blocks.map((block) => block.text)).toEqual([
      "悟空挺身在傍，且不朝礼。",
      "第一回 灵根育孕源流出",
    ]);
  });

  it("joins wrapped lines around Chinese punctuation and quotes", () => {
    const blocks = htmlToBlocks("<p>他说：\n“走吧。”\n然后……\n他走了。</p>");
    expect(blocks.map((block) => block.text)).toEqual([
      "他说：“走吧。”然后……他走了。",
    ]);
  });

  it("joins CJK text across blank source lines inside a block", () => {
    const blocks = htmlToBlocks("<p>郡侯道：\n\n“敝地大邦。”</p>");
    expect(blocks.map((block) => block.text)).toEqual(["郡侯道：“敝地大邦。”"]);
  });

  it("removes indent spaces that follow a source line break", () => {
    const blocks = htmlToBlocks("<p>都念：\n　　“南無燃燈上古佛。”</p>");
    expect(blocks.map((block) => block.text)).toEqual([
      "都念：“南無燃燈上古佛。”",
    ]);
  });

  it("drops ruby annotations and keeps inline text joined", () => {
    const blocks = htmlToBlocks(
      "<p><ruby>汉<rt>hàn</rt></ruby>字<em>与</em>词</p>",
    );
    expect(blocks.map((block) => block.text)).toEqual(["汉字与词"]);
  });

  it("keeps empty input empty", () => {
    expect(htmlToBlocks("   \n  ")).toEqual([]);
  });
});

describe("Markdown to blocks", () => {
  it("keeps headings and merges wrapped paragraph lines", () => {
    const blocks = markdownToBlocks(
      "# 第一章 春天\n\n他走在路上，\n看了一会儿云。\n\nSecond line\nanother line",
    );
    expect(blocks).toEqual([
      { text: "第一章 春天", heading: true },
      { text: "他走在路上，看了一会儿云。", heading: false },
      { text: "Second line another line", heading: false },
    ]);
  });

  it("strips inline formatting, links, quotes, and list markers", () => {
    const blocks = markdownToBlocks(
      "> **好句子**：见 [链接](https://example.com) 与 `代码`。\n\n- 一\n- 二\n\n---\n\n![封面](cover.png)",
    );
    expect(blocks.map((block) => block.text)).toEqual([
      "好句子：见 链接 与 代码。",
      "一",
      "二",
    ]);
  });

  it("keeps intraword underscores when converting Markdown", () => {
    const blocks = markdownToBlocks("见 file_name 与 a_b_c，*强调*和_斜体_。");
    expect(blocks.map((block) => block.text)).toEqual([
      "见 file_name 与 a_b_c，强调和斜体。",
    ]);
  });

  it("keeps fenced code text but drops the fence lines", () => {
    const blocks = markdownToBlocks("```\n旧信\n```\n\n之后。");
    expect(blocks.map((block) => block.text)).toEqual(["旧信", "之后。"]);
  });
});

describe("entities", () => {
  it("decodes named and numeric entities, leaving unknown ones intact", () => {
    expect(decodeEntities("&amp;&#65;&#x4E2D;&unknown;&#xGG;")).toBe(
      "&A中&unknown;&#xGG;",
    );
  });
});
