import type { Metadata } from "next";

import { SignInScreen } from "@/components/auth/sign-in-screen";
import { safeNextPath } from "@/server/auth/paths";
import { readPublicRegistration } from "@/server/auth/public-state";

import { single, type PageQuery } from "../query";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your OrbitDiff account.",
};

/**
 * `next` is kept only when it is a path on this site (safeNextPath). Anything
 * else is dropped here, before it reaches the browser code that navigates.
 */
export default async function SignInPage({ searchParams }: { searchParams: PageQuery }) {
  const query = await searchParams;
  const registration = await readPublicRegistration();
  const notice = single(query.confirm) ? "confirm" : single(query.reset) ? "reset" : null;
  return (
    <SignInScreen
      configured={registration.configured}
      next={safeNextPath(single(query.next))}
      mailCaptured={registration.mailCaptured}
      notice={notice}
    />
  );
}
