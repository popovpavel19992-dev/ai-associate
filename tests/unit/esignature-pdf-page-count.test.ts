// tests/unit/esignature-pdf-page-count.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { getPageCount } from "@/server/services/esignature/pdf-page-count";

describe("getPageCount", () => {
  it("returns correct page count for fixture", async () => {
    const buf = readFileSync("tests/fixtures/sample.pdf");
    const count = await getPageCount(buf);
    expect(count).toBe(3);
  });

  it("throws on non-PDF input", async () => {
    await expect(getPageCount(Buffer.from("not a pdf"))).rejects.toThrow();
  });
});
