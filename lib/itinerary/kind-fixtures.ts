import { rememberFideKind } from "./kind-cache";

/**
 * Test fixtures only: register routing kinds the way the graph would (kind
 * Statements). Hotels share the Concept type code with activities, so they are
 * listed explicitly. 0x40 ids are destinations; other 0x31 ids are activities.
 */
const HOTEL_FIXTURES = [
  "did:fide:0x312099ee71c0bbe3b30b275b32bbf65c900ef17a",
  "did:fide:0x3120f8d7d887bf79cfbce86593bd0e76764fcaff",
  "did:fide:0x3120777777777777777777777777777777777777",
  "did:fide:0x3120cccccccccccccccccccccccccccccccccccc",
  "did:fide:0x312012614b43c10e32222424c3994a5b059eee02",
];

export function registerFixtureKinds(ids: readonly string[]): void {
  for (const id of ids) {
    const typeCode = id.slice("did:fide:0x".length, "did:fide:0x".length + 2);
    if (HOTEL_FIXTURES.includes(id)) {
      rememberFideKind(id, "hotel");
    } else if (typeCode === "40") {
      rememberFideKind(id, "destination");
    } else if (typeCode === "31") {
      rememberFideKind(id, "activity");
    }
  }
}

/** Register every fixture id that appears in a test module. */
export function registerAllFixtureKinds(): void {
  registerFixtureKinds([
    ...HOTEL_FIXTURES,
    "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069",
    "did:fide:0x40207505aad72bc6866680f82c90589bf4e7caeb",
    "did:fide:0x402037d07239aa7a99e60ae0d9c31f02dc8d26a6",
    "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5",
    "did:fide:0x4020aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "did:fide:0x4020bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "did:fide:0x3120b1adca8b4d76b4a1616779887e8943b1c32e",
    "did:fide:0x3120dddddddddddddddddddddddddddddddddddd",
    "did:fide:0x4020b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1aa00",
    "did:fide:0x4020c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1aa00",
  ]);
}
