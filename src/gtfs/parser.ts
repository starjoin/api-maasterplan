import { parse } from 'csv-parse'
import { parse as parseSync } from 'csv-parse/sync'
import fs from 'node:fs'
import path from 'node:path'
import type {
  GtfsAgencyRow,
  GtfsCalendarDateRow,
  GtfsCalendarRow,
  GtfsFareAttributeRow,
  GtfsFareRuleRow,
  GtfsFiles,
  GtfsRouteRow,
  GtfsShapeRow,
  GtfsStopRow,
  GtfsStopTimeRow,
  GtfsTransferRow,
  GtfsTripRow,
} from './types.js'

/** Fichiers chargés en mémoire (petits). stop_times / shapes = streaming. */
const SMALL_GTFS_FILES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'fare_attributes.txt',
  'fare_rules.txt',
  'transfers.txt',
] as const

const CSV_OPTS = {
  columns: true as const,
  skip_empty_lines: true,
  trim: true,
  relax_column_count: true,
  bom: true,
}

function readCsvSync(filePath: string): Record<string, string>[] {
  const content = fs.readFileSync(filePath)
  const normalized =
    content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
      ? content.subarray(3)
      : content
  return parseSync(normalized, CSV_OPTS) as Record<string, string>[]
}

/**
 * Parse les tables GTFS « légères ».
 * stop_times.txt et shapes.txt sont volontairement exclus (streaming à part).
 */
export function parseGtfsDirectory(dir: string): GtfsFiles {
  const result: GtfsFiles = {}

  for (const filename of SMALL_GTFS_FILES) {
    const filePath = path.join(dir, filename)
    if (!fs.existsSync(filePath)) continue

    const rows = readCsvSync(filePath)

    switch (filename) {
      case 'agency.txt':
        result['agency.txt'] = rows as unknown as GtfsAgencyRow[]
        break
      case 'stops.txt':
        result['stops.txt'] = rows as unknown as GtfsStopRow[]
        break
      case 'routes.txt':
        result['routes.txt'] = rows as unknown as GtfsRouteRow[]
        break
      case 'trips.txt':
        result['trips.txt'] = rows as unknown as GtfsTripRow[]
        break
      case 'calendar.txt':
        result['calendar.txt'] = rows as unknown as GtfsCalendarRow[]
        break
      case 'calendar_dates.txt':
        result['calendar_dates.txt'] = rows as unknown as GtfsCalendarDateRow[]
        break
      case 'fare_attributes.txt':
        result['fare_attributes.txt'] = rows as unknown as GtfsFareAttributeRow[]
        break
      case 'fare_rules.txt':
        result['fare_rules.txt'] = rows as unknown as GtfsFareRuleRow[]
        break
      case 'transfers.txt':
        result['transfers.txt'] = rows as unknown as GtfsTransferRow[]
        break
    }
  }

  return result
}

export function gtfsFilePath(dir: string, filename: string): string | null {
  const filePath = path.join(dir, filename)
  return fs.existsSync(filePath) ? filePath : null
}

/**
 * Lit un CSV GTFS par lots (évite OOM sur stop_times / shapes).
 */
export async function forEachCsvBatch<T extends Record<string, string>>(
  filePath: string,
  batchSize: number,
  onBatch: (chunk: T[]) => Promise<void>,
): Promise<number> {
  let total = 0
  let batch: T[] = []

  const parser = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 }).pipe(
    parse({
      ...CSV_OPTS,
    }),
  )

  for await (const row of parser) {
    batch.push(row as T)
    if (batch.length >= batchSize) {
      total += batch.length
      await onBatch(batch)
      batch = []
      // Laisse respirer l’event loop
      await new Promise<void>((r) => setImmediate(r))
    }
  }

  if (batch.length > 0) {
    total += batch.length
    await onBatch(batch)
  }

  return total
}

export type { GtfsStopTimeRow, GtfsShapeRow }
