import cron from 'node-cron'
import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { syncGtfs } from '../gtfs/sync.js'

export function startScheduler(app: FastifyInstance) {
  if (!cron.validate(config.IMPORT_CRON)) {
    app.log.warn(`[Scheduler] Expression cron invalide : ${config.IMPORT_CRON}`)
    return
  }

  cron.schedule(config.IMPORT_CRON, () => {
    app.log.info('[Scheduler] Import GTFS planifié démarré')
    syncGtfs('scheduler').catch((err) => {
      app.log.error(err, '[Scheduler] Import GTFS échoué')
    })
  })

  app.log.info(`[Scheduler] Import planifié : ${config.IMPORT_CRON}`)
}
