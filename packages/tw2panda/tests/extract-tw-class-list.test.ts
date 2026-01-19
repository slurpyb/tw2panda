import { createMergeCss } from "@pandacss/shared";
import { describe, expect, test, beforeAll } from "vitest";
import { extractTwFileClassList } from "../src/extract-tw-class-list";
import { createPandaContext } from "../src/panda-context";
import { createTailwindContext, clearTailwindContextCache } from "../src/tw-context";
import { twClassListToPandaStyles } from "../src/tw-class-list-to-panda-styles";
import { TailwindContext } from "../src/tw-types";

// @ts-expect-error
import buttonRaw from "../samples/button?raw";

describe("extract-tw-class-list", () => {
  let tailwindContext: TailwindContext;

  beforeAll(async () => {
    clearTailwindContextCache();
    const tw = await createTailwindContext();
    tailwindContext = tw.context;
  });

  test("minimal - basic classes", async () => {
    const classList = new Set([
      "inline-flex",
      "items-center",
      "justify-center",
      "rounded-md",
      "text-sm",
      "font-medium",
    ]);

    const panda = createPandaContext();

    const stylesList = twClassListToPandaStyles(classList, tailwindContext, panda);

    // Verify we got some styles
    expect(stylesList.length).toBeGreaterThan(0);

    // Check for expected properties
    const allProps = stylesList.map((s) => s.match.propName);
    expect(allProps).toContain("display");
    expect(allProps).toContain("alignItems");
    expect(allProps).toContain("justifyContent");
  });

  test("classes with variants", async () => {
    const classList = new Set(["hover:bg-red-500", "focus:outline-none", "disabled:opacity-50"]);

    const panda = createPandaContext();

    const stylesList = twClassListToPandaStyles(classList, tailwindContext, panda);

    // Verify we got styles with modifiers
    expect(stylesList.length).toBeGreaterThan(0);

    // Check that styles have the correct nesting for variants
    const hoverStyle = stylesList.find((s) => s.match.classInfo.modifiers.includes("hover"));
    expect(hoverStyle).toBeDefined();
    expect(hoverStyle?.styles).toHaveProperty("_hover");

    const disabledStyle = stylesList.find((s) => s.match.classInfo.modifiers.includes("disabled"));
    expect(disabledStyle).toBeDefined();
    expect(disabledStyle?.styles).toHaveProperty("_disabled");
  });

  test("extractTwFileClassList from file content", async () => {
    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({
      utility: panda.utility,
      conditions: panda.conditions,
      hash: false,
    });

    const resultList = extractTwFileClassList(buttonRaw, tailwindContext, panda, mergeCss);

    // Verify we extracted some class lists
    expect(resultList.length).toBeGreaterThan(0);

    // Each result should have classList, node, and styles
    resultList.forEach((result) => {
      expect(result.classList).toBeInstanceOf(Set);
      expect(result.classList.size).toBeGreaterThan(0);
      expect(result.styles).toBeDefined();
      expect(typeof result.styles).toBe("object");
    });
  });

  test("important modifier (v4 syntax with ! at end)", async () => {
    const classList = new Set(["flex!", "bg-red-500!"]);

    const panda = createPandaContext();

    const stylesList = twClassListToPandaStyles(classList, tailwindContext, panda);

    // Verify important flag is set
    const importantStyles = stylesList.filter((s) => s.match.classInfo.isImportant);
    expect(importantStyles.length).toBeGreaterThan(0);
  });

  test("important modifier (v3 syntax with ! at beginning)", async () => {
    const classList = new Set(["!flex", "!bg-red-500"]);

    const panda = createPandaContext();

    const stylesList = twClassListToPandaStyles(classList, tailwindContext, panda);

    // Verify important flag is set (v3 syntax still supported)
    const importantStyles = stylesList.filter((s) => s.match.classInfo.isImportant);
    expect(importantStyles.length).toBeGreaterThan(0);
  });

  test("dark mode classes", async () => {
    const classList = new Set(["dark:bg-slate-800", "dark:text-white"]);

    const panda = createPandaContext();

    const stylesList = twClassListToPandaStyles(classList, tailwindContext, panda);

    // Verify dark mode styles are nested correctly
    expect(stylesList.length).toBeGreaterThan(0);

    const darkStyles = stylesList.filter((s) => s.match.classInfo.modifiers.includes("dark"));
    expect(darkStyles.length).toBeGreaterThan(0);
    darkStyles.forEach((s) => {
      expect(s.styles).toHaveProperty("_dark");
    });
  });

  test("responsive classes", async () => {
    const classList = new Set(["md:flex", "lg:hidden"]);

    const panda = createPandaContext();

    const stylesList = twClassListToPandaStyles(classList, tailwindContext, panda);

    // Verify responsive styles
    expect(stylesList.length).toBeGreaterThan(0);

    const mdStyle = stylesList.find((s) => s.match.classInfo.modifiers.includes("md"));
    expect(mdStyle).toBeDefined();
    expect(mdStyle?.styles).toHaveProperty("md");

    const lgStyle = stylesList.find((s) => s.match.classInfo.modifiers.includes("lg"));
    expect(lgStyle).toBeDefined();
    expect(lgStyle?.styles).toHaveProperty("lg");
  });
});
