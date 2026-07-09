import { getAllGatewayModels, getCapabilities, isDemo } from "@/lib/ai/models";

export async function GET() {
  const headers = {
    "Cache-Control": "no-store",
  };

  const curatedCapabilities = await getCapabilities();

  if (isDemo) {
    const models = await getAllGatewayModels();
    const capabilities = Object.fromEntries(
      models.map((m) => [m.id, curatedCapabilities[m.id] ?? m.capabilities])
    );

    return Response.json({ capabilities, models }, { headers });
  }

  return Response.json(curatedCapabilities, { headers });
}
