import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
      <div className="mb-6 text-center">
        <h1 className="font-mono text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Codegraph
        </h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Sign in to access your team&apos;s workspace
        </p>
      </div>
      <SignIn />
    </div>
  );
}
