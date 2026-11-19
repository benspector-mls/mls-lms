import { gitbookToHtml } from "@/lib/lessons/gitbook";

describe("gitbookToHtml", () => {
  it("turns a hint into an aside with blank lines around each tag, even with none written", () => {
    // How the first hint in "1.6 Loops" is written: no blank line between the tags and the text.
    const markdown = [
      '{% hint style="info" %}',
      "💡 Looking for another way to learn? Check out the [reading](https://example.com)",
      "{% endhint %}",
    ].join("\n");

    expect(gitbookToHtml(markdown)).toBe(
      [
        "",
        '<aside data-hint="info">',
        "",
        "💡 Looking for another way to learn? Check out the [reading](https://example.com)",
        "",
        "</aside>",
        "",
      ].join("\n"),
    );
  });

  it("wraps a titled code block and keeps the fence inside it untouched", () => {
    const markdown = [
      '{% code title="main.py" overflow="wrap" lineNumbers="true" %}',
      "```python",
      '{% hint style="info" %}',
      "```",
      "{% endcode %}",
    ].join("\n");

    expect(gitbookToHtml(markdown)).toBe(
      [
        "",
        '<div data-code-title="main.py">',
        "",
        "```python",
        '{% hint style="info" %}',
        "```",
        "",
        "</div>",
        "",
      ].join("\n"),
    );
  });

  it("keeps a tag's indentation, so a callout inside a list item stays in it", () => {
    expect(gitbookToHtml('   {% hint style="warning" %}')).toBe(
      '\n   <aside data-hint="warning">\n',
    );
  });

  it("turns an embed into an empty element carrying the address", () => {
    expect(
      gitbookToHtml('{% embed url="https://docs.google.com/presentation/d/abc/embed" %}'),
    ).toBe('\n<div data-embed="https://docs.google.com/presentation/d/abc/embed"></div>\n');
  });

  it("escapes an attribute value so it cannot close the tag", () => {
    expect(gitbookToHtml('{% code title="a&b<c" %}')).toBe(
      '\n<div data-code-title="a&amp;b&lt;c">\n',
    );
  });

  it("leaves a tag that shares its line with text as written, rather than open a callout it cannot close", () => {
    const line = '{% hint style="info" %}A short note{% endhint %}';
    expect(gitbookToHtml(line)).toBe(line);
  });

  it("leaves a tag it does not know as written", () => {
    expect(gitbookToHtml("{% tabs %}")).toBe("{% tabs %}");
  });
});
