import cron from 'node-cron'
import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { syncDataset } from '../gtfs/sync.js'
import { getActiveSource } from '../db.js'

export function startScheduler(app: FastifyInstance) {
  if (!cron.validate(config.IMPORT_CRON)) {
    app.log.warn(`[Scheduler] Expression cron invalide : ${config.IMPORT_CRON}`)
    return
  }

  cron.schedule(config.IMPORT_CRON, () => {
    app.log.info(`[Scheduler] Import ${getActiveSource()} planifié démarré`)
    syncDataset('scheduler').catch((err) => {
      app.log.error(err, '[Scheduler] Import échoué')
    })
  })

  app.log.info(`[Scheduler] Import planifié : ${config.IMPORT_CRON}`)
}
