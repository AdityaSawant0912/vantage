import { describe, expect, it } from "vitest";
import { VANTAGE_CORE_VERSION } from "../src/index.js";

describe("usevantage", () => {
  it("exports a version placeholder", () => {
    expect(VANTAGE_CORE_VERSION).toBe("0.0.0");
  });
});
