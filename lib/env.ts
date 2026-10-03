export function validateEnv() {
  const requiredEnvVars = [
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'CLERK_SECRET_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ] as const;

  const missing = requiredEnvVars.filter((key) => {
    const value = process.env[key];
    return !value || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `[Environment Error] Missing or empty required environment variables: ${missing.join(
        ', '
      )}.`
    );
  }
}

validateEnv();
