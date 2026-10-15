import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Clears a stale login cookie (its user no longer exists) and sends the browser to login.
 * Never mints a guest session: with login required, the only way in is a real account.
 */
export async function GET() {
  const store = await cookies();
  for (const name of ["authjs.session-token", "__Secure-authjs.session-token"]) {
    store.delete(name);
  }
  redirect("/login");
}
