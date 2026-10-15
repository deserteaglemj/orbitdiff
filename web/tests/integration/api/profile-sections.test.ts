import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChangesLoader } from "@/app/(app)/profiles/[id]/sections";
import type { ChangesState } from "@/components/profile/rows";
import { closeDb } from "@/server/db/client";
import { importExport } from "@/server/services/imports";
import { createProfile, getProfile } from "@/server/services/profiles";

import { createVerifiedUser, resetDatabase, restoreTestEnv } from "../../helpers";
import { ATLAS, exportPayload, markDerived, NOW } from "../services/support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const SECOND = { capturedAt: "2026-09-10T12:00:00+00:00" };

/** The state the Changes section of a profile page is given, read the way the page reads it. */
async function changesStateOf(exports: Array<Record<string, unknown>>): Promise<ChangesState> {
  const owner = await createVerifiedUser({ email: ATLAS, onboarded: true });
  const created = await createProfile(owner.userId, "atlas_studio", NOW);
  for (const payload of exports) await importExport(owner.userId, created.id, exportPayload(payload), NOW);
  await markDerived(created.id);
  const profile = await getProfile(owner.userId, created.id, NOW);
  const element = await ChangesLoader({ userId: owner.userId, profile, query: { tab: "changes" }, timeZone: "UTC" });
  return (element.props as { state: ChangesState }).state;
}

describe("the Changes section of a profile page", () => {
  it("says nothing could be compared for two exports whose lists were not declared complete", async () => {
    const partial = { completeFollowers: false, completeFollowing: false };
    const state = await changesStateOf([
      { ...partial, followers: ["nova_labs", "pixel_forge"] },
      { ...partial, ...SECOND, followers: ["ember_lab", "nova_labs"] },
    ]);
    expect(state).toMatchObject({ kind: "not_comparable", title: "Nothing could be compared" });
  });

  it("says no differences were observed for two complete exports with the same lists", async () => {
    const state = await changesStateOf([{}, SECOND]);
    expect(state).toMatchObject({ kind: "none_observed", title: "No differences observed" });
    expect(state.detail).not.toContain("could not be compared");
  });
});
