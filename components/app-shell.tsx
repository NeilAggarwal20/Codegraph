'use client';

import React from 'react';
import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import { ThemeToggle } from './theme-toggle';
import { ActiveOrgContext } from '@/lib/org';
import { OrgSync } from './org-sync';

interface AppShellProps {
  activeOrg: ActiveOrgContext;
  children: React.ReactNode;
}

export function AppShell({ activeOrg, children }: AppShellProps) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground font-sans text-xs">
      <OrgSync targetOrgId={activeOrg.id} />

      {/* Top Application Bar */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-surface px-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold tracking-tight text-accent">
              Codegraph
            </span>
            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-mono font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              v0.1
            </span>
          </div>

          <div className="h-4 w-px bg-border" />

          {/* Organization Switcher */}
          <div className="flex items-center gap-2">
            <OrganizationSwitcher
              afterCreateOrganizationUrl="/"
              afterLeaveOrganizationUrl="/"
              afterSelectOrganizationUrl="/"
              appearance={{
                elements: {
                  rootBox: 'flex items-center',
                  organizationSwitcherTrigger:
                    'flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-mono bg-background text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors',
                },
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <div className="h-4 w-px bg-border" />
          <UserButton
            appearance={{
              elements: {
                avatarBox: 'h-6 w-6',
              },
            }}
          />
        </div>
      </header>

      {/* Workspace Panel Grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main Content & Graph Canvas Panel */}
        <main className="flex flex-1 flex-col overflow-hidden border-r border-border bg-background">
          {children}
        </main>

        {/* Right Detail Panel Placeholder */}
        <aside className="w-80 shrink-0 flex flex-col border-l border-border bg-surface">
          <div className="flex h-8 items-center justify-between border-b border-border px-3 font-mono text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
            <span>Detail Panel</span>
          </div>
          <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] text-zinc-500">
            <p className="italic">Select a node or file to inspect details.</p>
          </div>
        </aside>
      </div>

      {/* Bottom Chat / Query Panel Placeholder */}
      <footer className="h-28 shrink-0 flex flex-col border-t border-border bg-surface">
        <div className="flex h-7 items-center justify-between border-b border-border px-3 font-mono text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
          <span>Repository Assistant</span>
        </div>
        <div className="flex-1 p-2 flex items-center justify-between px-3 text-zinc-400 font-mono text-[11px]">
          <span>Ask a structural question about the parsed graph...</span>
        </div>
      </footer>
    </div>
  );
}
