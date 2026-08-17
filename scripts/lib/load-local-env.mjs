import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return false

  // Explicit process variables override persisted local defaults.
  const existing = new Map(Object.entries(process.env))
  process.loadEnvFile(envPath)
  for (const [key, value] of existing) process.env[key] = value
  return true
}

loadLocalEnv()
