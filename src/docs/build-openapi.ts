import { prisma } from '../db.js'
import { designerEndpointToOperation, type DesignerEndpoint } from './from-designer.js'
import { SAE_OPENAPI_PATHS } from './sae-spec.js'
import type { ResponseSchema } from '../engine/types.js'

export async function buildOpenApiDocument(serverUrl?: string) {
  const rows = await prisma.apiEndpoint.findMany({
    include: { params: true },
    orderBy: [{ path: 'asc' }, { method: 'asc' }],
  })

  const endpoints: DesignerEndpoint[] = rows.map((ep) => ({
    ...ep,
    responseSchema: JSON.parse(ep.responseSchema) as ResponseSchema & { native?: string },
  }))

  const paths: Record<string, Record<string, unknown>> = {
    ...structuredClone(SAE_OPENAPI_PATHS),
  }

  const catalog: Array<Record<string, unknown>> = []

  // Documenter aussi health
  paths['/health'] = {
    get: {
      tags: ['Système'],
      summary: 'Healthcheck',
      description: 'Vérifie que le service répond. Utilisé par Coolify / Docker.',
      operationId: 'health',
      responses: {
        '200': {
          description: 'OK',
          content: {
            'application/json': {
              example: { status: 'ok', service: 'api-maasterplan', ts: '2026-09-03T00:00:00.000Z' },
            },
          },
        },
      },
    },
  }

  for (const ep of endpoints) {
    // Les endpoints avec preset sont réellement exécutés par le moteur dynamique
    if (ep.responseSchema.preset) {
      const converted = designerEndpointToOperation(ep)
      catalog.push({
        group: 'SAE (preset Designer)',
        method: ep.method,
        path: converted.openApiPath,
        summary: converted.operation.summary,
        description: converted.operation.description,
        active: ep.isActive,
        source: 'designer-preset',
        parameters: converted.operation.parameters,
        example: converted.meta.example,
        curl: converted.meta.curl,
        designerId: ep.id,
      })
      // Continuer pour aussi enregistrer le path OpenAPI via la boucle normale
    }

    const { openApiPath, method, operation, meta } = designerEndpointToOperation(ep)

    if (!paths[openApiPath]) paths[openApiPath] = {}
    if (!paths[openApiPath][method]) {
      paths[openApiPath][method] = operation
    }

    if (!ep.responseSchema.preset) {
      catalog.push({
        group: ep.path.startsWith('/v1/custom') ? 'Designer (déclaratif)' : 'Designer',
        method: ep.method,
        path: openApiPath,
        summary: operation.summary,
        description: meta.explanation,
        active: ep.isActive,
        source: 'designer',
        entity: meta.entity,
        parameters: operation.parameters,
        example: meta.example,
        curl: meta.curl,
        designerId: ep.id,
        updatedAt: ep.updatedAt,
      })
    }
  }

  // Compléter avec la spec SAE OpenAPI enrichie (exemples) si absente du Designer
  for (const [path, methods] of Object.entries(SAE_OPENAPI_PATHS)) {
    for (const [method, op] of Object.entries(methods)) {
      const operation = op as {
        summary?: string
        description?: string
        parameters?: unknown[]
        responses?: Record<string, { content?: { 'application/json'?: { example?: unknown } } }>
        'x-codeSamples'?: Array<{ lang: string; source: string }>
      }
      const already = catalog.some(
        (c) => c.path === path && String(c.method).toLowerCase() === method.toLowerCase(),
      )
      if (already) continue

      const example = operation.responses?.['200']?.content?.['application/json']?.example
      const curl = operation['x-codeSamples']?.find((s) => s.lang === 'cURL')?.source

      catalog.push({
        group: 'SAE (natif)',
        method: method.toUpperCase(),
        path,
        summary: operation.summary,
        description: operation.description,
        active: true,
        source: 'sae',
        parameters: operation.parameters ?? [],
        example,
        curl:
          curl ??
          `curl -sS "https://api.example.com${path.replace(/\{[^}]+\}/g, '82')}"`,
      })
    }
  }

  catalog.sort((a, b) => String(a.path).localeCompare(String(b.path)))

  const baseUrl = serverUrl || 'http://localhost:3000'

  const document = {
    openapi: '3.1.0',
    info: {
      title: 'Maasterplan API',
      version: '1.0.0',
      summary: 'API GTFS haut niveau — RFU Sytral Mobilités',
      description: [
        'API de mobilité style **Navitia / SAE**, sans calcul d’itinéraire.',
        '',
        '## Sources de la documentation',
        '',
        'Cette spécification OpenAPI est **générée dynamiquement** à partir de l’**API Designer** :',
        '',
        '1. Endpoints **preset SAE** (lignes Navitia, places, nearby, thermomètre…)',
        '2. Endpoints **déclaratifs GTFS** (projection libre champs / filtres)',
        '',
        'Activer, désactiver ou projeter des champs dans le Designer change l’API et cette doc.',
        '',
        '## Conventions',
        '',
        '- Préfixe public : `/api`',
        '- Pagination : `?limit=` & `?offset=` (plafond 500)',
        '- Réponses JSON, UTF-8',
        '- Pas d’authentification sur l’API publique (à ajouter en amont si besoin : reverse-proxy Coolify)',
        '',
        '## Liens utiles',
        '',
        `- Documentation interactive : [\`/docs\`](${baseUrl}/docs)`,
        `- Spécification brute : [\`/openapi.json\`](${baseUrl}/openapi.json)`,
        `- Catalogue SAE : [\`/api/v1/endpoints\`](${baseUrl}/api/v1/endpoints)`,
        `- Health : [\`/health\`](${baseUrl}/health)`,
      ].join('\n'),
      contact: { name: 'Maasterplan' },
      license: { name: 'Proprietary' },
    },
    servers: [
      { url: baseUrl, description: 'Instance courante' },
      { url: '{baseUrl}', description: 'URL personnalisée', variables: { baseUrl: { default: baseUrl } } },
    ],
    tags: [
      {
        name: 'SAE (preset Designer)',
        description:
          'Endpoints métier (Navitia-like) pilotés par un preset dans l’API Designer — activation et projection des clés inclus.',
      },
      {
        name: 'Designer (déclaratif)',
        description: 'Endpoints créés via projection GTFS libre (entité, champs, filtres).',
      },
      {
        name: 'Designer',
        description: 'Autres endpoints déclaratifs.',
      },
      {
        name: 'Système',
        description: 'Supervision et santé du service.',
      },
    ],
    paths,
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Not found' },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
            hasMore: { type: 'boolean' },
          },
        },
      },
    },
    'x-generated-at': new Date().toISOString(),
    'x-endpoint-count': Object.keys(paths).length,
  }

  return { document, catalog, endpoints }
}

export function renderDocsHtml(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Maasterplan API — Documentation</title>
  <meta name="description" content="Documentation OpenAPI dynamique de l'API Maasterplan (GTFS / SAE)." />
  <style>
    body { margin: 0; }
    .mp-banner {
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: #111827;
      color: #e5e7eb;
      padding: 10px 16px;
      font-size: 13px;
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    }
    .mp-banner a { color: #4ade80; text-decoration: none; }
    .mp-banner a:hover { text-decoration: underline; }
    .mp-banner strong { color: #fff; }
  </style>
</head>
<body>
  <div class="mp-banner">
    <strong>Maasterplan API</strong>
    <span>Documentation générée dynamiquement depuis l’API Designer + SAE</span>
    <a href="${baseUrl}/openapi.json" target="_blank" rel="noreferrer">openapi.json</a>
    <a href="${baseUrl}/docs/catalog" target="_blank" rel="noreferrer">catalogue JSON</a>
    <a href="${baseUrl}/" rel="noreferrer">Admin</a>
  </div>
  <div id="scalar-docs"></div>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.116"></script>
  <script>
    Scalar.createApiReference('#scalar-docs', {
      url: '${baseUrl}/openapi.json',
      theme: 'default',
      layout: 'modern',
      hideModels: false,
      defaultOpenAllTags: false,
      hiddenClients: [],
      metaData: {
        title: 'Maasterplan API',
        description: 'API GTFS / SAE Sytral Mobilités'
      }
    })
  </script>
</body>
</html>`
}
