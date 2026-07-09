import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { signIn } from "@/app/(auth)/auth";
import { isDevelopmentEnvironment } from "@/lib/constants";
import { getUserById } from "@/lib/db/queries";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawRedirect = searchParams.get("redirectUrl") || "/";
  const redirectUrl =
    rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/";

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  // Token can outlive the PGlite row (DB wipe / migrate). Only skip
  // guest minting when the session user still exists.
  if (token?.id) {
    const existing = await getUserById(String(token.id));
    if (existing) {
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      return NextResponse.redirect(new URL(`${base}/`, request.url));
    }
  }

  return signIn("guest", { redirect: true, redirectTo: redirectUrl });
}
