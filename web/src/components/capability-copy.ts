/**
 * What the interface says about Instagram and identity collection. The landing page, the terms,
 * and the standing notice all show these sentences, so they cannot drift apart.
 *
 * docs/web/capability-matrix.md supports exactly this much: no endpoint lets an app list follower
 * or following identities, and the export the owner requests is the identity path. Do not widen
 * the claim to "no authorized way to list them": the owner export is an authorized way.
 * Change the matrix first, then this file.
 */
export const NO_APP_COLLECTION =
  "Instagram offers no authorized way for an app to collect the accounts that follow you or that you follow.";

export const ONLY_EXPORT_SOURCE = "The only authorized source is the export you request from Instagram yourself.";

/** Both sentences, the limit first and the source second. */
export const IDENTITY_SOURCE = `${NO_APP_COLLECTION} ${ONLY_EXPORT_SOURCE}`;
