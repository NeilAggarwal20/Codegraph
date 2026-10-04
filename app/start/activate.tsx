"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { resolveOrganization } from "./action";

export function Activate() {
  const { setActive } = useClerk();
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;

    started.current = true;

    resolveOrganization()
      .then((organization) => setActive({ organization }))
      .then(() => router.replace("/"))
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

  return <p>Setting up your organization...</p>;
}
