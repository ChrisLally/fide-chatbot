import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";

const weatherInputSchema = z.object({
  city: z.string().min(1),
});

async function geocodeCity(
  city: string
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const response = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return null;
    }

    const result = data.results[0];
    return {
      latitude: result.latitude,
      longitude: result.longitude,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:api").toResponse();
  }

  let input: z.infer<typeof weatherInputSchema>;

  try {
    input = weatherInputSchema.parse(await request.json());
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const coords = await geocodeCity(input.city);

  if (!coords) {
    return Response.json({
      error: `Could not find coordinates for "${input.city}". Please check the city name.`,
    });
  }

  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`
  );

  const weatherData = await response.json();

  return Response.json({
    ...weatherData,
    cityName: input.city,
  });
}
