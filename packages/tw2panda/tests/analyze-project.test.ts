import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "pathe";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getFilesToAnalyze } from "../src/analyze/project";

/**
 * Regression guard for the hand-rolled glob: `**\/*.tsx` must match a file at
 * the scan root (no leading slash), not only files nested under a directory.
 * The previous conversion compiled `**\/` to `.*\/`, which required a slash and
 * silently skipped every top-level file, under-counting migration reports.
 */
describe("analyze-project / getFilesToAnalyze", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "tw2panda-glob-"));
    // Root-level files (the previously-missed case)
    writeFileSync(join(dir, "App.tsx"), `<div className="flex" />`);
    writeFileSync(join(dir, "index.html"), `<div class="p-4"></div>`);
    // Nested file
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "Card.tsx"), `<div className="grid" />`);
    // Excluded / non-matching
    writeFileSync(join(dir, "notes.md"), `# not a source file`);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("matches root-level and nested source files", () => {
    const found = getFilesToAnalyze(dir).map((f) => f.slice(dir.length + 1));
    expect(found.sort()).toEqual(["App.tsx", "index.html", join("src", "Card.tsx")].sort());
  });

  test("does not match unrelated extensions", () => {
    const found = getFilesToAnalyze(dir);
    expect(found.some((f) => f.endsWith("notes.md"))).toBe(false);
  });
});
