import { auth, clerkClient } from '@clerk/nextjs/server';
import './env';

export interface ActiveOrgContext {
  id: string;
  name: string;
  slug: string | null;
  imageUrl: string | null;
  role: string | null;
  isAutoCreated: boolean;
}

export async function getOrEnsureOrganization(): Promise<ActiveOrgContext | null> {
  const { userId, orgId, orgRole, orgSlug } = await auth();

  if (!userId) {
    return null;
  }

  const client = await clerkClient();

  if (orgId) {
    try {
      const org = await client.organizations.getOrganization({ organizationId: orgId });
      return {
        id: org.id,
        name: org.name,
        slug: org.slug || orgSlug || null,
        imageUrl: org.imageUrl || null,
        role: orgRole || null,
        isAutoCreated: false,
      };
    } catch {
      // If fetching fails, fall back to checking user's memberships
    }
  }

  // Check existing memberships for the user
  try {
    const membershipsResponse = await client.users.getOrganizationMembershipList({ userId });
    const memberships = membershipsResponse.data;

    if (memberships.length > 0) {
      const activeMembership = memberships[0];
      const org = activeMembership.organization;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug || null,
        imageUrl: org.imageUrl || null,
        role: activeMembership.role || null,
        isAutoCreated: false,
      };
    }
  } catch (err) {
    console.error('Error fetching organization memberships:', err);
  }

  // Brand new user with 0 organizations: auto-create an organization without asking
  try {
    const user = await client.users.getUser(userId);
    const primaryEmail = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId
    )?.emailAddress;

    let orgName = 'My Team';
    if (user.firstName) {
      orgName = `${user.firstName}'s Team`;
    } else if (user.username) {
      orgName = `${user.username}'s Team`;
    } else if (primaryEmail) {
      const prefix = primaryEmail.split('@')[0];
      orgName = `${prefix}'s Team`;
    }

    const createdOrg = await client.organizations.createOrganization({
      name: orgName,
      createdBy: userId,
    });

    return {
      id: createdOrg.id,
      name: createdOrg.name,
      slug: createdOrg.slug || null,
      imageUrl: createdOrg.imageUrl || null,
      role: 'org:admin',
      isAutoCreated: true,
    };
  } catch (err) {
    console.error('Error auto-creating organization:', err);
    throw new Error('Failed to resolve or auto-create organization for user');
  }
}
