interface EnvBackup {
  [key: string]: string | undefined;
}

/**
 * Backs up the specified environment variables.
 * @param envVars Array of environment variable names to backup
 * @returns Object containing backed up environment variables
 */
export function backupEnvVars(envVars: string[]): EnvBackup {
  const backup: EnvBackup = {};
  
  for (const envVar of envVars) {
    backup[envVar] = process.env[envVar];
  }
  
  return backup;
}

/**
 * Clears the specified environment variables if condition is true.
 * @param envVars Array of environment variables to clear
 * @param condition Optional condition to check before clearing
 */
export function clearEnvVars(envVars: string[], condition: boolean = true): void {
  if (condition) {
    for (const envVar of envVars) {
      delete process.env[envVar];
    }
  }
}

/**
 * Restores environment variables from a backup.
 * @param backup Object containing environment variable backup
 */
export function restoreEnvVars(backup: EnvBackup): void {
  for (const [key, value] of Object.entries(backup)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Azure OpenAI environment variables
 */
export const AZURE_OPENAI_ENV_VARS = [
  'AZURE_OPENAI_API_DEPLOYMENT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_ENDPOINT'
];

export const OPENAI_ENV_VARS = [
    'OPENAI_API_KEY',
    'OPENAI_API_URL'
];

