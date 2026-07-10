/**
 * Cloudflare Worker: catalinaquest.reeflabs.io → test.fide.work
 *
 * Public URLs keep the /demo prefix for app routes:
 *   catalinaquest.reeflabs.io/          → test.fide.work/demo
 *   catalinaquest.reeflabs.io/api/...   → test.fide.work/demo/api/...
 *   catalinaquest.reeflabs.io/demo-assets/... → test.fide.work/demo-assets/...
 *
 * Paste into Cloudflare Workers for catalinaquest.reeflabs.io (route: *catalinaquest.reeflabs.io/*)
 */

const ORIGIN = "https://test.fide.work";
const PUBLIC_HOST = "catalinaquest.reeflabs.io";

/** Map public path → origin path (add /demo unless already /demo or /demo-assets). */
function toUpstreamPath(pathname) {
  if (pathname.startsWith("/demo-assets")) {
    return pathname;
  }
  // Allow /demo* through unchanged (bookmarks / accidental links)
  if (pathname === "/demo" || pathname.startsWith("/demo/")) {
    return pathname;
  }
  if (pathname === "/") {
    return "/demo";
  }
  return `/demo${pathname}`;
}

/** Rewrite absolute origin locations to the public host without stripping /demo. */
function rewriteLocation(location) {
  if (!location) {
    return location;
  }

  let rewritten = location.replaceAll(
    "https://test.fide.work",
    `https://${PUBLIC_HOST}`,
  );

  return rewritten;
}

function rewriteSetCookie(cookie) {
  return cookie.replaceAll("test.fide.work", PUBLIC_HOST);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const upstreamPath = toUpstreamPath(url.pathname);
    const upstreamUrl = ORIGIN + upstreamPath + url.search;

    const headers = new Headers(request.headers);
    headers.set("Host", "test.fide.work");
    headers.set("X-Forwarded-Host", PUBLIC_HOST);
    headers.set("X-Forwarded-Proto", "https");

    // test.fide.work Cloudflare hotlink protection 403s when Referer is
    // another host (e.g. catalinaquest.reeflabs.io). Spoof same-origin.
    headers.set("Referer", ORIGIN + "/");
    headers.delete("Origin");

    const response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });

    const outHeaders = new Headers(response.headers);

    const location = outHeaders.get("Location");
    if (location) {
      outHeaders.set("Location", rewriteLocation(location));
    }

    const cookies = outHeaders.getSetCookie?.() ?? [];
    if (cookies.length > 0) {
      outHeaders.delete("Set-Cookie");
      for (const cookie of cookies) {
        outHeaders.append("Set-Cookie", rewriteSetCookie(cookie));
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outHeaders,
    });
  },
};
