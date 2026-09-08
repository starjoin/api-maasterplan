const { test } = require('node:test')
const assert = require('node:assert/strict')

process.env.RFU_API_TOKEN = 'fixture'
process.env.NODE_ENV = 'test'

const {
  geometryFeatureCollection,
  geometryFromRouteExtras,
  matchNavitiaLine,
  parseNavitiaGeometry,
} = require('../dist/navitia/line-geometries.js')

test('validates, matches and exposes Navitia line geometries', () => {
  const geometry = {
    type: 'MultiLineString',
    coordinates: [[[4.8,45.7],[4.81,45.71]]],
  }
  assert.deepEqual(parseNavitiaGeometry(geometry), geometry)
  assert.equal(parseNavitiaGeometry({ type: 'LineString', coordinates: [[400,45],[4,45]] }), null)
  assert.equal(parseNavitiaGeometry({ type: 'MultiLineString', coordinates: [[]] }), null)

  const candidates = [
    { id: 'one', code: 'C 1', name: 'Gare Part-Dieu', geojson: geometry },
    { id: 'two', code: 'C 1', name: 'Gare de Vaise', geojson: geometry },
    { id: 'three', code: 'A', name: 'Métro A', geojson: geometry },
  ]
  assert.equal(matchNavitiaLine({ shortName: 'A', longName: 'Métro A' }, candidates).id, 'three')
  assert.equal(matchNavitiaLine({ shortName: 'C-1', longName: 'Gare de Vaïse' }, candidates).id, 'two')
  assert.equal(matchNavitiaLine({ shortName: '', longName: 'Gare Part-Dieu' }, candidates), null)

  const stored = JSON.stringify({ navitia: { geojson: geometry } })
  assert.deepEqual(geometryFromRouteExtras(stored), geometry)
  const collection = geometryFeatureCollection(geometry, { line_id: 'fixture' })
  assert.equal(collection.features[0].properties.geometry_source, 'navitia')
})
