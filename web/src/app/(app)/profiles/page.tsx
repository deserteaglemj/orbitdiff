import { redirect } from "next/navigation";

import { workspaceUser } from "@/components/dashboard/workspace-access";
import { DASHBOARD_PATH } from "@/server/auth/paths";

/** Profiles are listed on the dashboard. This address leads there, after the same checks as every other page. */
export default async function ProfilesIndexPage() {
  await workspaceUser();
  redirect(DASHBOARD_PATH);
}
