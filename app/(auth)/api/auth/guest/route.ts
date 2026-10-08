import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { signIn } from "@/app/(auth)/auth";
import {
  appBasePath,
  isAuthRequired,
  isDevelopmentEnvironment,
} from "@/lib/constants";
import { getUserById } from "@/lib/db/queries";

export async function GET(request: Request) {
  const base = appBasePath;

  if (isAuthRequired()) {
    return NextResponse.redirect(new URL(`${base}/login`, request.url));
  }

  const { searchParams } = new URL(request.url);
  const rawRedirect = searchParams.get("redirectUrl") || "/";
  const redirectUrl =
    rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/";

  // Auth.js redirectTo is host-absolute. Under demo basePath (/demo),
  // "/" would escape to the site root (workspace gateway) — prefix it.
  const redirectTo =
    base && !redirectUrl.startsWith(base)
      ? `${base}${redirectUrl === "/" ? "/" : redirectUrl}`
      : redirectUrl;

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  // Only reuse an existing guest cookie when the User row still exists.
  // Stale JWTs (DB wipe/delete) mint a fresh guest — never restore the old id.
  if (token?.id) {
    const existing = await getUserById(String(token.id));
    if (existing) {
      return NextResponse.redirect(new URL(`${base}/`, request.url));
    }
  }

  return signIn("guest", { redirect: true, redirectTo });
}
