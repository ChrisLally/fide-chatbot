import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { loadPlacePoliciesFromWorldModel } from "@/lib/itinerary/wm-place-policy";
import { z } from "zod";

const bodySchema = z.object({
  placeIds: z.array(z.string()).max(40),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const policies = await loadPlacePoliciesFromWorldModel(parsed.data.placeIds);
  return Response.json({
    policies: Object.fromEntries(
      [...policies.entries()].map(([id, policy]) => [id, policy])
    ),
  });
}
