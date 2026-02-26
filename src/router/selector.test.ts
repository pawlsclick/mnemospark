import { describe, expect, it } from "vitest";

import { calculateModelCost, selectModel, type ModelPricing } from "./selector.js";
import type { TierConfig } from "./types.js";

const TIER_CONFIGS: Record<"SIMPLE" | "MEDIUM" | "COMPLEX" | "REASONING", TierConfig> = {
  SIMPLE: { primary: "moonshot/kimi-k2.5", fallback: [] },
  MEDIUM: { primary: "moonshot/kimi-k2.5", fallback: [] },
  COMPLEX: { primary: "moonshot/kimi-k2.5", fallback: [] },
  REASONING: { primary: "moonshot/kimi-k2.5", fallback: [] },
};

const MODEL_PRICING = new Map<string, ModelPricing>([
  ["moonshot/kimi-k2.5", { inputPrice: 0.5, outputPrice: 2.4 }],
  ["anthropic/claude-opus-4-5", { inputPrice: 5, outputPrice: 25 }],
]);

describe("selectModel", () => {
  it("uses dashed Claude baseline ID when computing savings", () => {
    const decision = selectModel(
      "SIMPLE",
      0.95,
      "rules",
      "test",
      TIER_CONFIGS,
      MODEL_PRICING,
      1000,
      1000,
    );

    expect(decision.baselineCost).toBeGreaterThan(0);
    expect(decision.savings).toBeGreaterThan(0);
  });
});

describe("calculateModelCost", () => {
  it("uses dashed Claude baseline ID when recomputing fallback costs", () => {
    const costs = calculateModelCost("moonshot/kimi-k2.5", MODEL_PRICING, 1000, 1000);

    expect(costs.baselineCost).toBeGreaterThan(0);
    expect(costs.savings).toBeGreaterThan(0);
  });
});
