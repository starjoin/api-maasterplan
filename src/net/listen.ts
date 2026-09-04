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
 * Écoute Fastify sur `preferredPort`, ou le prochain libre si occupé.
 * En cas de EADDRINUSE « flash » (tsx watch), retente d’abord le même port.
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

  // Retries courts sur le port préféré (relance watch)
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
