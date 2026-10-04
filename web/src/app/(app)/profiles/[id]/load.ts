import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { workspaceUser } from "@/components/dashboard/workspace-access";
import type { SessionUser } from "@/server/auth/guards";
import { AppError } from "@/server/http/errors";
import type { ProfileDto } from "@/server/services/contracts";
import { getProfile } from "@/server/services/profiles";

export interface OwnedProfile {
  user: SessionUser;
  profile: ProfileDto;
  /** The clock the profile was read with. The page measures the age of the export against the same one. */
  now: Date;
}

/**
 * The signed-in user and the profile with this id, when it is that user's.
 *
 * An id that is malformed, that does not exist, and that belongs to another
 * account all end the same way: the service answers `not_found` for each, and
 * this function turns that into the not-found page. Nothing of a profile is
 * read before the ownership check, which is part of the query itself.
 *
 * Returns null for a suspended account: the layout shows the notice and the
 * page renders nothing. Memoized for the request, so the page title and the
 * page body come from one check.
 */
export const loadOwnedProfile = cache(async (id: string): Promise<OwnedProfile | null> => {
  const user = await workspaceUser();
  if (user === null) return null;
  const now = new Date();
  try {
    return { user, profile: await getProfile(user.id, id, now), now };
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
});
