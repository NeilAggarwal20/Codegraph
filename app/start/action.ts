"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";

export async function resolveOrganization(): Promise<string | null> {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Not signed in");
  }

  const clerk = await clerkClient();

  const memberships =
    await clerk.users.getOrganizationMembershipList({
      userId,
      limit: 2,
    });

  if (memberships.totalCount > 1) {
    return null;
  }
  if (memberships.totalCount === 1) {
    const membership = memberships.data[0];
    if (!membership) throw new Error("Could not load your organization membership.");
    return membership.organization.id;
  }
  if (memberships.totalCount !== 0) {
    throw new Error("Could not determine your organization memberships.");
  }

  const user = await clerk.users.getUser(userId);
  const profileName = user.fullName ?? user.username ?? user.primaryEmailAddress?.emailAddress.split("@")[0];
  if (!profileName) {
    throw new Error("Add your name to your profile before creating an organization.");
  }

  const org = await clerk.organizations.createOrganization({
    name: `${profileName}'s team`,
    createdBy: userId,
  });

  return org.id;
}
