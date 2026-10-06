import { checkColumns, checkSpecSchema } from "@/lib/checks/spec";

const valid = {
  objective: "Explain why a closure can read variables after its outer function returns.",
  question: "What does `counter()` return the second time it is called, and why?",
  factsExample: "It returns 2. The inner function uses `count`.",
  exemplar: "It returns 2, because the inner function keeps a reference to `count`…",
  retryWait: { days: 7, hours: 0 },
};

describe("checkSpecSchema", () => {
  it("accepts a whole check", () => {
    expect(checkSpecSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a check without either example", () => {
    expect(checkSpecSchema.safeParse({ ...valid, exemplar: "  " }).success).toBe(false);
    expect(checkSpecSchema.safeParse({ ...valid, factsExample: "" }).success).toBe(false);
  });

  it("accepts a wait of nothing, and refuses one that is not whole hours", () => {
    expect(checkSpecSchema.safeParse({ ...valid, retryWait: { days: 0, hours: 0 } }).success).toBe(
      true,
    );
    expect(
      checkSpecSchema.safeParse({ ...valid, retryWait: { days: 0, hours: 1.5 } }).success,
    ).toBe(false);
    expect(checkSpecSchema.safeParse({ ...valid, retryWait: { days: 0, hours: 1 } }).success).toBe(
      true,
    );
  });

  it("refuses a field it does not know rather than dropping it", () => {
    expect(checkSpecSchema.safeParse({ ...valid, levelGuide: {} }).success).toBe(false);
  });
});

describe("checkColumns", () => {
  it("stores the wait as hours", () => {
    expect(checkColumns(checkSpecSchema.parse(valid)).retryWaitHours).toBe(168);
    expect(
      checkColumns(checkSpecSchema.parse({ ...valid, retryWait: { days: 1, hours: 6 } }))
        .retryWaitHours,
    ).toBe(30);
  });
});
