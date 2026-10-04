"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";

export async function resolveOrganization(): Promise<string> {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Not signed in");
  }

  const clerk = await clerkClient();

  const memberships =
    await clerk.users.getOrganizationMembershipList({
      userId,
      limit: 1,
    });

  const existing = memberships.data[0];

  if (existing) {
    return existing.organization.id;
  }

  const org = await clerk.organizations.createOrganization({
    name: "Neil's team",
    createdBy: userId,
  });

  return org.id;
}