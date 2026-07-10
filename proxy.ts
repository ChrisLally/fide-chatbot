import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { guestRegex, isDevelopmentEnvironment } from "./lib/constants";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const loginPath = "/demo/login";
  const normalizedPathname =
    base && pathname.startsWith(base)
      ? pathname.slice(base.length) || "/"
      : pathname;
  const isApiRoute = normalizedPathname.startsWith("/api");
  const isAuthPage = ["/login", "/register"].includes(normalizedPathname);

  if (!token) {
    if (isDevelopmentEnvironment || isApiRoute || isAuthPage) {
      return NextResponse.next();
    }

    return NextResponse.redirect(new URL(loginPath, request.url));
  }

  const isGuest = guestRegex.test(token?.email ?? "");

  if (
    token &&
    !isGuest &&
    ["/login", "/register"].includes(normalizedPathname)
  ) {
    return NextResponse.redirect(new URL(`${base}/`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|images/).*)",
  ],
};
