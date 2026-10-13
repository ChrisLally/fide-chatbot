import { loadPlacePoliciesFromWorldModel } from "../lib/itinerary/wm-place-policy";
import { createFideMcpClient } from "../lib/fide/mcp-client";
import { harvestEntitiesFromRunView } from "../lib/itinerary/entity-binder";
const SYDNEY = "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";
async function main() {
  const policies = await loadPlacePoliciesFromWorldModel([SYDNEY]);
  const p = policies.get(SYDNEY);
  console.log("policy:", p ? { name: p.placeName, min: p.stayMinNights, rec: p.stayRecommendedNights, max: p.stayMaxNights, incompatible: p.incompatibleOvernightFideIds } : "MISSING");
  const client = await createFideMcpClient();
  if (!client) throw new Error("no MCP client");
  const tools = await client.tools();
  const raw = await (tools.run_view as any).execute({ worldModelKey: "catalina-world-model", viewKey: "inventory/places-search", params: { q: "Sydney" } }, { toolCallId: "x", messages: [] });
  console.log("harvested:", harvestEntitiesFromRunView("inventory/places-search", raw));
  await client.close();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
