export async function register() {
  // @vercel/otel currently crashes under Turbopack in this nested standalone
  // layout ("could not convert import.meta.url to filepath"). Skip in dev.
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const { registerOTel } = await import("@vercel/otel");
  registerOTel({ serviceName: "chatbot" });
}
