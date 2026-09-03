import type { FastifyInstance } from 'fastify'
import * as sae from './handlers.js'

type Q = Record<string, string | undefined>

/**
 * API SAE / Navitia-like (sans calcul d'itinéraire).
 * Routes natives optimisées — enregistrées avant le moteur dynamique.
 */
export async function saeRoutes(app: FastifyInstance) {
  // ── Coverage / discovery ──────────────────────────────────────────────────
  app.get('/api/v1/coverage', async (_req, reply) => reply.send(await sae.coverage()))
  app.get('/api/v1', async (_req, reply) => reply.send(await sae.coverage()))

  // ── Modes ─────────────────────────────────────────────────────────────────
  app.get('/api/v1/physical_modes', async (_req, reply) => reply.send(await sae.physicalModes()))
  app.get('/api/v1/modes', async (_req, reply) => reply.send(await sae.physicalModes()))

  // ── Networks / agencies ───────────────────────────────────────────────────
  app.get('/api/v1/networks', async (_req, reply) => reply.send(await sae.listNetworks()))
  app.get('/api/v1/agencies', async (_req, reply) => reply.send(await sae.listNetworks()))

  // ── Lines ─────────────────────────────────────────────────────────────────
  app.get('/api/v1/lines', async (req, reply) => {
    return reply.send(await sae.listLines(req.query as Q))
  })
  app.get('/api/v1/lignes', async (req, reply) => {
    return reply.send(await sae.listLines(req.query as Q))
  })

  app.get<{ Params: { id: string } }>('/api/v1/lines/:id', async (req, reply) => {
    const result = await sae.getLine(req.params.id, req.query as Q)
    if (!result) return reply.status(404).send({ error: 'Ligne introuvable' })
    return reply.send(result)
  })
  app.get<{ Params: { id: string } }>('/api/v1/lignes/:id', async (req, reply) => {
    const result = await sae.getLine(req.params.id, req.query as Q)
    if (!result) return reply.status(404).send({ error: 'Ligne introuvable' })
    return reply.send(result)
  })

  // Thermomètre
  app.get<{ Params: { id: string } }>('/api/v1/lines/:id/stop_points', async (req, reply) => {
    const result = await sae.lineThermometer(req.params.id, req.query as Q)
    if (!result) return reply.status(404).send({ error: 'Ligne introuvable' })
    return reply.send(result)
  })
  app.get<{ Params: { id: string } }>('/api/v1/lines/:id/route_schedules', async (req, reply) => {
    const result = await sae.lineSchedules(req.params.id, req.query as Q)
    if (!result) return reply.status(404).send({ error: 'Ligne introuvable' })
    return reply.send(result)
  })
  app.get<{ Params: { id: string } }>('/api/v1/lignes/:id/thermometre', async (req, reply) => {
    const result = await sae.lineThermometer(req.params.id, req.query as Q)
    if (!result) return reply.status(404).send({ error: 'Ligne introuvable' })
    return reply.send(result)
  })
  app.get<{ Params: { id: string } }>('/api/v1/lignes/:id/horaires', async (req, reply) => {
    const result = await sae.lineSchedules(req.params.id, req.query as Q)
    if (!result) return reply.status(404).send({ error: 'Ligne introuvable' })
    return reply.send(result)
  })

  // Tracé GeoJSON
  app.get<{ Params: { id: string } }>('/api/v1/lines/:id/geojson', async (req, reply) => {
    const result = await sae.lineGeojson(req.params.id, req.query as Q)
    if (!result) return reply.status(404).send({ error: 'Ligne introuvable' })
    return reply.send(result)
  })
  app.get<{ Params: { id: string } }>('/api/v1/lignes/:id/trace', async (req, reply) => {
    const result = await sae.lineGeojson(req.params.id, req.query as Q)
    if (!result) return reply.status(404).send({ error: 'Ligne introuvable' })
    return reply.send(result)
  })

  // Lignes par mode
  app.get<{ Params: { mode: string } }>('/api/v1/physical_modes/:mode/lines', async (req, reply) => {
    return reply.send(await sae.listLines({ ...(req.query as Q), physical_mode: req.params.mode }))
  })
  app.get<{ Params: { mode: string } }>('/api/v1/modes/:mode/lignes', async (req, reply) => {
    return reply.send(await sae.listLines({ ...(req.query as Q), physical_mode: req.params.mode }))
  })

  // ── Stop points / arrêts ──────────────────────────────────────────────────
  app.get('/api/v1/stop_points', async (req, reply) => {
    return reply.send(await sae.listStopPoints(req.query as Q))
  })
  app.get('/api/v1/stop_areas', async (req, reply) => {
    return reply.send(await sae.listStopPoints({ ...(req.query as Q), stop_areas_only: 'true' }))
  })
  app.get('/api/v1/arrets', async (req, reply) => {
    return reply.send(await sae.listStopPoints(req.query as Q))
  })

  app.get<{ Params: { id: string } }>('/api/v1/stop_points/:id', async (req, reply) => {
    const result = await sae.getStopPoint(req.params.id)
    if (!result) return reply.status(404).send({ error: 'Arrêt introuvable' })
    return reply.send(result)
  })
  app.get<{ Params: { id: string } }>('/api/v1/arrets/:id', async (req, reply) => {
    const result = await sae.getStopPoint(req.params.id)
    if (!result) return reply.status(404).send({ error: 'Arrêt introuvable' })
    return reply.send(result)
  })

  app.get<{ Params: { id: string } }>('/api/v1/stop_points/:id/schedules', async (req, reply) => {
    const result = await sae.stopSchedules(req.params.id, req.query as Q)
    if (!result) return reply.status(404).send({ error: 'Arrêt introuvable' })
    return reply.send(result)
  })
  app.get<{ Params: { id: string } }>('/api/v1/stop_points/:id/departures', async (req, reply) => {
    const result = await sae.stopSchedules(req.params.id, req.query as Q)
    if (!result) return reply.status(404).send({ error: 'Arrêt introuvable' })
    return reply.send(result)
  })
  app.get<{ Params: { id: string } }>('/api/v1/arrets/:id/horaires', async (req, reply) => {
    const result = await sae.stopSchedules(req.params.id, req.query as Q)
    if (!result) return reply.status(404).send({ error: 'Arrêt introuvable' })
    return reply.send(result)
  })

  // ── Places / autocomplete ─────────────────────────────────────────────────
  app.get('/api/v1/places', async (req, reply) => {
    return reply.send(await sae.places(req.query as Q))
  })
  app.get('/api/v1/lieux', async (req, reply) => {
    return reply.send(await sae.places(req.query as Q))
  })

  // ── Places nearby ─────────────────────────────────────────────────────────
  app.get('/api/v1/places_nearby', async (req, reply) => {
    const result = await sae.placesNearby(req.query as Q)
    if ('error' in result) return reply.status(400).send(result)
    return reply.send(result)
  })
  app.get('/api/v1/lieux_proches', async (req, reply) => {
    const result = await sae.placesNearby(req.query as Q)
    if ('error' in result) return reply.status(400).send(result)
    return reply.send(result)
  })

  // ── POI ───────────────────────────────────────────────────────────────────
  app.get('/api/v1/poi', async (req, reply) => {
    return reply.send(await sae.listPoi(req.query as Q))
  })
  app.get<{ Params: { id: string } }>('/api/v1/poi/:id', async (req, reply) => {
    const result = await sae.getPoi(req.params.id)
    if (!result) return reply.status(404).send({ error: 'POI introuvable' })
    return reply.send(result)
  })

  // ── Vehicle journeys / courses ────────────────────────────────────────────
  app.get('/api/v1/vehicle_journeys', async (req, reply) => {
    return reply.send(await sae.listVehicleJourneys(req.query as Q))
  })
  app.get('/api/v1/courses', async (req, reply) => {
    return reply.send(await sae.listVehicleJourneys(req.query as Q))
  })
  app.get<{ Params: { id: string } }>('/api/v1/vehicle_journeys/:id', async (req, reply) => {
    const result = await sae.getVehicleJourney(req.params.id)
    if (!result) return reply.status(404).send({ error: 'Course introuvable' })
    return reply.send(result)
  })
  app.get<{ Params: { id: string } }>('/api/v1/courses/:id', async (req, reply) => {
    const result = await sae.getVehicleJourney(req.params.id)
    if (!result) return reply.status(404).send({ error: 'Course introuvable' })
    return reply.send(result)
  })

  // ── Catalogue / index des endpoints SAE ───────────────────────────────────
  app.get('/api/v1/endpoints', async (_req, reply) => {
    return reply.send({
      description: 'API SAE style Navitia — sans calcul d\'itinéraire',
      endpoints: [
        { method: 'GET', path: '/api/v1/coverage', description: 'Métadonnées du jeu de données' },
        { method: 'GET', path: '/api/v1/physical_modes', description: 'Modes de transport (bus, tram…)' },
        { method: 'GET', path: '/api/v1/physical_modes/{mode}/lines', description: 'Lignes par mode' },
        { method: 'GET', path: '/api/v1/networks', description: 'Réseaux / agences' },
        { method: 'GET', path: '/api/v1/lines', description: 'Liste des lignes (?physical_mode=&q=)' },
        { method: 'GET', path: '/api/v1/lines/{id}', description: 'Détail d\'une ligne' },
        { method: 'GET', path: '/api/v1/lines/{id}/stop_points', description: 'Thermomètre (séquence d\'arrêts)' },
        { method: 'GET', path: '/api/v1/lines/{id}/geojson', description: 'Tracé GeoJSON' },
        { method: 'GET', path: '/api/v1/lines/{id}/route_schedules', description: 'Horaires de la ligne' },
        { method: 'GET', path: '/api/v1/stop_points', description: 'Liste des arrêts' },
        { method: 'GET', path: '/api/v1/stop_areas', description: 'Stations (location_type=1)' },
        { method: 'GET', path: '/api/v1/stop_points/{id}', description: 'Détail arrêt + lignes' },
        { method: 'GET', path: '/api/v1/stop_points/{id}/schedules', description: 'Horaires / départs' },
        { method: 'GET', path: '/api/v1/places?q=', description: 'Autocomplétion lieux' },
        { method: 'GET', path: '/api/v1/places_nearby?lat=&lon=', description: 'Lieux à proximité' },
        { method: 'GET', path: '/api/v1/poi', description: 'Points d\'intérêt (stations)' },
        { method: 'GET', path: '/api/v1/vehicle_journeys', description: 'Courses GTFS' },
        { method: 'GET', path: '/api/v1/vehicle_journeys/{id}', description: 'Détail course + stop_times' },
      ],
      aliases_fr: [
        '/api/v1/lignes',
        '/api/v1/lignes/{id}/thermometre',
        '/api/v1/lignes/{id}/trace',
        '/api/v1/lignes/{id}/horaires',
        '/api/v1/arrets',
        '/api/v1/arrets/{id}/horaires',
        '/api/v1/lieux',
        '/api/v1/lieux_proches',
        '/api/v1/modes',
        '/api/v1/courses',
      ],
    })
  })

  app.log.info('[SAE] Endpoints Navitia-like enregistrés sous /api/v1/*')
}
