"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";

import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { type LoginActionState, login } from "../actions";

function loginErrorMessage(status: LoginActionState["status"]) {
  if (status === "failed") {
    return "Incorrect email or password.";
  }
  if (status === "invalid_data") {
    return "Enter a valid email and a password of at least 6 characters.";
  }
  return null;
}

export default function Page() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);

  const [state, formAction] = useActionState<LoginActionState, FormData>(
    login,
    { status: "idle" }
  );

  const { update: updateSession } = useSession();
  const errorMessage = loginErrorMessage(state.status);

  // biome-ignore lint/correctness/useExhaustiveDependencies: router and updateSession are stable refs
  useEffect(() => {
    if (state.status === "success") {
      setIsSuccessful(true);
      updateSession();
      // next/navigation router already prefixes basePath (/demo) — do not add it again.
      router.replace("/");
      router.refresh();
    }
  }, [state.status]);

  const handleSubmit = (formData: FormData) => {
    setEmail(formData.get("email") as string);
    formAction(formData);
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-sm text-muted-foreground">
        Sign in to your account to continue
      </p>
      <AuthForm action={handleSubmit} defaultEmail={email}>
        {errorMessage ? (
          <p
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}
        <SubmitButton isSuccessful={isSuccessful}>Sign in</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          No account? Contact the{" "}
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="https://reeflabs.io"
            rel="noreferrer"
            target="_blank"
          >
            Reef Labs
          </Link>
          {" team"}
        </p>
      </AuthForm>
    </>
  );
}
