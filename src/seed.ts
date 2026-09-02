import { PrismaClient } from '@prisma/client'

const DEFAULT_LINES_SCHEMA = {
  entity: 'Route',
  multiple: true,
  filters: [],
  fields: [
    { output: 'id', db: 'routeId' },
    { output: 'numero', db: 'shortName' },
    { output: 'nom', db: 'longName' },
    { output: 'type', db: 'type' },
    { output: 'couleur', db: 'color' },
    { output: 'couleurTexte', db: 'textColor' },
  ],
  orderBy: { field: 'sortOrder', direction: 'asc' },
  paginate: true,
}

const DEFAULT_LINE_SCHEMA = {
  entity: 'Route',
  multiple: false,
  filters: [{ field: 'routeId', source: 'path', key: 'routeId', operator: 'eq' }],
  fields: [
    { output: 'id', db: 'routeId' },
    { output: 'numero', db: 'shortName' },
    { output: 'nom', db: 'longName' },
    { output: 'type', db: 'type' },
    { output: 'couleur', db: 'color' },
    { output: 'couleurTexte', db: 'textColor' },
    { output: 'description', db: 'desc' },
    { output: 'url', db: 'url' },
  ],
}

export async function seedDefaultEndpoints(prisma: PrismaClient) {
  await prisma.datasetMeta.upsert({
    where: { id: 'default' },
    create: { id: 'default' },
    update: {},
  })

  const endpoints = [
    {
      path: '/v1/lignes',
      method: 'GET',
      description: 'Liste des lignes de transport (GTFS routes)',
      responseSchema: JSON.stringify(DEFAULT_LINES_SCHEMA),
      params: [
        { name: 'limit', type: 'number', location: 'query', required: false, description: 'Nombre max de résultats (défaut 100)' },
        { name: 'offset', type: 'number', location: 'query', required: false, description: 'Décalage pagination' },
        { name: 'type', type: 'number', location: 'query', required: false, description: 'Filtrer par type GTFS (0=tram, 3=bus…)' },
      ],
    },
    {
      path: '/v1/lignes/:routeId',
      method: 'GET',
      description: "Détail d'une ligne par son identifiant GTFS",
      responseSchema: JSON.stringify(DEFAULT_LINE_SCHEMA),
      params: [
        { name: 'routeId', type: 'string', location: 'path', required: true, description: 'Identifiant GTFS de la ligne' },
      ],
    },
  ]

  for (const ep of endpoints) {
    const { params, ...data } = ep
    const existing = await prisma.apiEndpoint.findUnique({
      where: { path_method: { path: data.path, method: data.method } },
    })

    if (!existing) {
      await prisma.apiEndpoint.create({
        data: {
          ...data,
          params: { create: params },
        },
      })
    }
  }
}
