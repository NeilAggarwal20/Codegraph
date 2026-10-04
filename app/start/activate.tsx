"use client";

import { OrganizationList, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { resolveOrganization } from "./action";

export function Activate() {
  const { setActive } = useClerk();
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [needsOrganizationChoice, setNeedsOrganizationChoice] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;

    started.current = true;

    resolveOrganization()
      .then((organization) => {
        if (!organization) {
          setNeedsOrganizationChoice(true);
          return;
        }
        return setActive({ organization }).then(() => router.replace("/"));
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [setActive, router]);

  if (error) {
    return (
      <p>
        Couldn&apos;t set up your organization: {error}
      </p>
    );
  }

  if (needsOrganizationChoice) {
    return (
      <div className="space-y-4">
        <h1 className="font-mono text-lg font-semibold">Choose an organization</h1>
        <OrganizationList
          hidePersonal
          afterSelectOrganizationUrl="/"
          afterCreateOrganizationUrl="/"
        />
      </div>
    );
  }

  return <p>Setting up your organization...</p>;
}
