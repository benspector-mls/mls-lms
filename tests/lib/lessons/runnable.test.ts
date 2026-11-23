import {
  buildWebPage,
  CONSOLE_BRIDGE,
  codeOf,
  fenceLanguage,
  markRunnable,
  readSetups,
} from "@/lib/lessons/runnable";

/**
 * Which blocks get a Run button, which blocks run together, and the page a web block runs in.
 */

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  children?: Node[];
  properties?: Record<string, unknown>;
};

function pre(language: string | null, text: string): Node {
  return {
    type: "element",
    tagName: "pre",
    properties: {},
    children: [
      {
        type: "element",
        tagName: "code",
        properties: language ? { className: [`language-${language}`] } : {},
        children: [{ type: "text", value: `${text}\n` }],
      },
    ],
  };
}

function element(tagName: string, children: Node[] = []): Node {
  return { type: "element", tagName, properties: {}, children };
}

/** An HTML comment as the parser hands it over: its text between `<!--` and `-->`. */
function comment(value: string): Node {
  return { type: "comment", value };
}

const text = (value: string): Node => ({ type: "text", value });

describe("fenceLanguage and codeOf", () => {
  it("reads the fence's language and the block's text without its final newline", () => {
    expect(fenceLanguage(pre("Python", "x = 1"))).toBe("python");
    expect(fenceLanguage(pre(null, "x"))).toBeNull();
    expect(codeOf(pre("python", "print(1)"))).toBe("print(1)");
  });
});

describe("markRunnable", () => {
  it("marks Python and lone JavaScript blocks, and leaves other languages alone", () => {
    const tree = element("root", [
      pre("py", "print(1)"),
      pre("js", "console.log(1)"),
      pre("bash", "ls"),
    ]);
    markRunnable(tree);
    expect(tree.children!.map((node) => node.properties!.dataRun)).toEqual([
      "python",
      "javascript",
      undefined,
    ]);
  });

  it("gives an HTML block the CSS and JavaScript after it, which then get no button of their own", () => {
    const tree = element("root", [
      pre("html", "<p>Hi</p>"),
      element("p"),
      pre("css", "p { color: red }"),
      pre("javascript", "console.log('hi')"),
    ]);
    markRunnable(tree);
    const [html, , css, js] = tree.children!;
    expect(html.properties).toEqual({
      dataRun: "web",
      dataRunCss: "p { color: red }",
      dataRunJs: "console.log('hi')",
    });
    expect(css.properties).toEqual({ dataRunPart: "css" });
    expect(js.properties).toEqual({ dataRunPart: "javascript" });
  });

  it("reads a titled fence as its block, as the HTML block and as a companion", () => {
    const titled = (title: string, block: Node): Node => ({
      type: "element",
      tagName: "div",
      properties: { dataCodeTitle: title },
      children: [{ type: "text", value: "\n" }, block],
    });
    const tree = element("root", [
      titled("index.html", pre("html", "<p>Hi</p>")),
      titled("style.css", pre("css", "p {}")),
    ]);
    markRunnable(tree);
    const [html, css] = tree.children!.map((node) => node.children![1]);
    expect(html.properties).toEqual({ dataRun: "web", dataRunCss: "p {}" });
    expect(css.properties).toEqual({ dataRunPart: "css" });
  });

  it("stops looking for companions at a heading or the next HTML block, and finds blocks at any depth", () => {
    const tree = element("root", [
      element("section", [
        pre("html", "<p>One</p>"),
        element("h3"),
        pre("css", "p {}"),
        pre("html", "<p>Two</p>"),
        pre("js", "x"),
      ]),
      element("details", [pre("python", "pass")]),
    ]);
    markRunnable(tree);
    const section = tree.children![0].children!;
    expect(section[0].properties).toEqual({ dataRun: "web" });
    expect(section[2].properties).toEqual({});
    expect(section[3].properties).toEqual({ dataRun: "web", dataRunJs: "x" });
    expect(tree.children![1].children![0].properties).toEqual({ dataRun: "python" });
  });
});

describe("hidden setups", () => {
  const eventSetup = comment(" setup: event\nclass Event:\n    pass\n");
  const hallSetup = comment(" setup: hall\nhall = []\n");

  it("reads every setup on the page, at any depth, without the newline before the closing", () => {
    const tree = element("root", [eventSetup, element("details", [hallSetup])]);
    expect(readSetups(tree)).toEqual(
      new Map([
        ["event", "class Event:\n    pass"],
        ["hall", "hall = []"],
      ]),
    );
  });

  it("gives a block the setups it names, in the order named, and names any that are missing", () => {
    const block = pre("python", "print(hall)");
    const tree = element("root", [
      eventSetup,
      hallSetup,
      comment(" uses: hall, event, venue "),
      text("\n"),
      block,
    ]);
    markRunnable(tree);
    expect(block.properties).toEqual({
      dataRun: "python",
      dataSetup: "hall = []\n\nclass Event:\n    pass",
      dataSetupMissing: "venue",
    });
  });

  it("reaches a titled fence through its wrapper, and applies to nothing when another element comes first", () => {
    const titled = pre("python", "print(1)");
    const later = pre("python", "print(2)");
    const tree = element("root", [
      eventSetup,
      comment(" uses: event "),
      text("\n"),
      { type: "element", tagName: "div", properties: { dataCodeTitle: "a.py" }, children: [titled] },
      comment(" uses: event "),
      element("p"),
      later,
    ]);
    markRunnable(tree);
    expect(titled.properties).toEqual({ dataRun: "python", dataSetup: "class Event:\n    pass" });
    expect(later.properties).toEqual({ dataRun: "python" });
  });

  it("leaves a block marked not-runnable without a button, whatever its language", () => {
    const python = pre("python", "pass");
    const html = pre("html", "<p>Hi</p>");
    const css = pre("css", "p {}");
    const tree = element("root", [
      comment(" not-runnable "),
      python,
      comment(" not-runnable "),
      html,
      css,
    ]);
    markRunnable(tree);
    expect(python.properties).toEqual({});
    expect(html.properties).toEqual({});
    expect(css.properties).toEqual({});
  });
});

describe("buildWebPage", () => {
  it("wraps a fragment in a document with the bridge first, the style in the head and the script at the end", () => {
    const page = buildWebPage({ html: "<p>Hi</p>", css: "p { color: red }", js: "console.log(1)" });
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page.indexOf(CONSOLE_BRIDGE)).toBeLessThan(page.indexOf("<style>"));
    expect(page).toContain("<style>\np { color: red }\n</style>");
    expect(page.indexOf("<p>Hi</p>")).toBeLessThan(page.indexOf("<script>\nconsole.log(1)"));
    expect(page.endsWith("</body>\n</html>")).toBe(true);
  });

  it("puts the pieces into a document the block already has", () => {
    const page = buildWebPage({
      html: "<html><head><title>T</title></head><body><p>Hi</p></body></html>",
      css: "p {}",
      js: "run()",
    });
    expect(page).toContain(`<head>\n${CONSOLE_BRIDGE}\n<style>\np {}\n</style><title>T</title>`);
    expect(page).toContain("<p>Hi</p><script>\nrun()\n</script>\n</body>");
  });

  it("leaves out a style or a script there is no code for", () => {
    const page = buildWebPage({ html: "<p>Hi</p>" });
    expect(page).not.toContain("<style>");
    expect(page).not.toContain("<script>\n");
  });
});
