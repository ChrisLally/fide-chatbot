import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  appBasePath,
  guestRegex,
  isAuthRequired,
  isDevelopmentEnvironment,
} from "./lib/constants";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (pathname.startsWith("/api/auth")) {
    // Guest mint disabled when login is required.
    if (
      isAuthRequired() &&
      (pathname === `${appBasePath}/api/auth/guest` ||
        pathname.endsWith("/api/auth/guest"))
    ) {
      return NextResponse.redirect(
        new URL(`${appBasePath}/login`, request.url)
      );
    }
    return NextResponse.next();
  }

  // assetPrefix (/demo-assets) is outside basePath; never force guest auth on it.
  // Also: `/demo-assets`.startsWith(`/demo`) is true — must not strip as basePath.
  if (pathname.startsWith("/demo-assets")) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  const base = appBasePath;
  // Require a path boundary so `/demo-assets/...` is not treated as `/demo` + `-assets/...`.
  const underBase =
    Boolean(base) && (pathname === base || pathname.startsWith(`${base}/`));
  const normalizedPathname = underBase
    ? pathname.slice(base.length) || "/"
    : pathname;

  const isApiRoute = normalizedPathname.startsWith("/api");
  const isAuthPage = ["/login", "/register"].includes(normalizedPathname);
  const requireLogin = isAuthRequired();
  const isGuest = guestRegex.test(token?.email ?? "");
  const hasRegularSession = Boolean(token) && !isGuest;

  if (requireLogin) {
    // Existing guest cookies are not enough — force a real account.
    if (!hasRegularSession) {
      if (isAuthPage) {
        return NextResponse.next();
      }
      if (isApiRoute) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const redirectUrl = encodeURIComponent(normalizedPathname);
      return NextResponse.redirect(
        new URL(
          `${base}/login?redirectUrl=${redirectUrl}`,
          request.url
        )
      );
    }

    if (isAuthPage) {
      return NextResponse.redirect(new URL(`${base}/`, request.url));
    }

    return NextResponse.next();
  }

  if (!token) {
    // Demo / open mode: auto guest session for pages.
    if (isApiRoute || isAuthPage) {
      return NextResponse.next();
    }

    const redirectUrl = encodeURIComponent(normalizedPathname);
    return NextResponse.redirect(
      new URL(`${base}/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
    );
  }

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

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|images/|demo-assets/).*)",
  ],
};
