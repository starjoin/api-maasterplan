import net from 'node:net'
import type { FastifyInstance } from 'fastify'

/** Vérifie si un port TCP est libre sur host. */
export function isPortFree(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, host, () => {
      server.close(() => resolve(true))
    })
  })
}

/** Trouve le premier port libre à partir de `start` (inclus). */
export async function findFreePort(
  start: number,
  opts: { host?: string; maxAttempts?: number } = {},
): Promise<number> {
  const host = opts.host ?? '0.0.0.0'
  const maxAttempts = opts.maxAttempts ?? 40

  for (let i = 0; i < maxAttempts; i++) {
    const port = start + i
    if (await isPortFree(port, host)) return port
  }

  throw new Error(`Aucun port libre entre ${start} et ${start + maxAttempts - 1}`)
}

/**
 * Écoute Fastify sur `preferredPort`.
 * En production (Coolify / Docker) : port fixe uniquement — jamais de bascule,
 * sinon le proxy/healthcheck pointe vers un mauvais port → 503.
 * En dev : retries puis prochain port libre (tsx watch).
 */
export async function listenDynamic(
  app: FastifyInstance,
  preferredPort: number,
  host: string,
): Promise<number> {
  const tryListen = async (port: number) => {
    await app.listen({ port, host })
    return port
  }

  const isProd = process.env.NODE_ENV === 'production'

  if (isProd) {
    await tryListen(preferredPort)
    return preferredPort
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await tryListen(preferredPort)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'EADDRINUSE') throw err
      await new Promise((r) => setTimeout(r, 150 + attempt * 100))
    }
  }

  const port = await findFreePort(preferredPort + 1, { host })
  app.log.warn(`[Server] Port ${preferredPort} occupé — bascule sur ${port}`)
  return tryListen(port)
}
