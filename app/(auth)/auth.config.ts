import type { NextAuthConfig } from "next-auth";
import { appBasePath } from "@/lib/constants";

const base = appBasePath;

export const authConfig = {
  basePath: "/api/auth",
  trustHost: true,
  pages: {
    signIn: `${base}/login`,
    newUser: `${base}/`,
  },
  providers: [],
  callbacks: {},
} satisfies NextAuthConfig;
