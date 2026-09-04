#!/usr/bin/env node
/**
 * Lance api + vite en partageant un port API libre (évite EADDRINUSE / proxy cassé).
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function isPortFree(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, host, () => {
      server.close(() => resolve(true))
    })
  })
}

async function findFreePort(start, maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = start + i
    if (await isPortFree(port)) return port
  }
  throw new Error(`Aucun port libre à partir de ${start}`)
}

const preferred = Number(process.env.PORT || 3000)
const port = await findFreePort(preferred)

if (port !== preferred) {
  console.log(`[dev] Port ${preferred} occupé → API sur ${port}`)
} else {
  console.log(`[dev] API sur le port ${port}`)
}

const env = {
  ...process.env,
  PORT: String(port),
  API_PORT: String(port),
}

const child = spawn(
  'npx',
  [
    'concurrently',
    '-k',
    '-n',
    'api,web',
    '-c',
    'cyan,magenta',
    'npm run dev:api',
    'npm run dev:client',
  ],
  {
    cwd: root,
    env,
    stdio: 'inherit',
    // shell:false pour que chaque entrée soit un seul argument (sinon « npm run … » est découpé)
    shell: false,
  },
)

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
