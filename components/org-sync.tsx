'use client';

import { useAuth, useClerk } from '@clerk/nextjs';
import { useEffect } from 'react';

export function OrgSync({ targetOrgId }: { targetOrgId: string }) {
  const { orgId } = useAuth();
  const { setActive } = useClerk();

  useEffect(() => {
    if (targetOrgId && orgId !== targetOrgId && setActive) {
      setActive({ organization: targetOrgId }).catch((err) => {
        console.error('Failed to sync active organization session:', err);
      });
    }
  }, [targetOrgId, orgId, setActive]);

  return null;
}
