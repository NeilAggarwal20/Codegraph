import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ThemeControl } from "@/components/theme-control";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { orgId } = await auth();

  if (!orgId) {
    redirect("/start");
  }

  const theme = parseTheme(
    (await cookies()).get(THEME_COOKIE)?.value
  );

  return (
    <div className="m-0 flex min-h-screen flex-col p-0">
      <header className="m-0 flex h-16 shrink-0 items-center gap-5 border-b border-line bg-surface px-6 py-0">
        <span className="font-mono text-xl font-semibold tracking-tight text-fg">
          codegraph
        </span>

        <span className="text-xl text-fg-muted">/</span>

        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/"
          afterCreateOrganizationUrl="/"
          afterLeaveOrganizationUrl="/start"
        />

        <div className="ml-auto flex items-center gap-5">
          <ThemeControl initial={theme} />
          <UserButton
            appearance={{
              elements: {
                avatarBox: "h-10 w-10",
              },
            }}
          />
        </div>
      </header>

      <main className="m-0 min-h-0 flex-1 p-0">
        {children}
      </main>
    </div>
  );
}