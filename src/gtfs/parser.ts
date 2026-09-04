import { parse } from 'csv-parse/sync'
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

const GTFS_FILE_NAMES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'shapes.txt',
  'fare_attributes.txt',
  'fare_rules.txt',
  'transfers.txt',
] as const

export function parseGtfsDirectory(dir: string): GtfsFiles {
  const result: GtfsFiles = {}

  for (const filename of GTFS_FILE_NAMES) {
    const filePath = path.join(dir, filename)
    if (!fs.existsSync(filePath)) continue

    const content = fs.readFileSync(filePath)
    const normalized =
      content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
        ? content.subarray(3)
        : content

    const rows = parse(normalized, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    })

    switch (filename) {
      case 'agency.txt':
        result['agency.txt'] = rows as GtfsAgencyRow[]
        break
      case 'stops.txt':
        result['stops.txt'] = rows as GtfsStopRow[]
        break
      case 'routes.txt':
        result['routes.txt'] = rows as GtfsRouteRow[]
        break
      case 'trips.txt':
        result['trips.txt'] = rows as GtfsTripRow[]
        break
      case 'stop_times.txt':
        result['stop_times.txt'] = rows as GtfsStopTimeRow[]
        break
      case 'calendar.txt':
        result['calendar.txt'] = rows as GtfsCalendarRow[]
        break
      case 'calendar_dates.txt':
        result['calendar_dates.txt'] = rows as GtfsCalendarDateRow[]
        break
      case 'shapes.txt':
        result['shapes.txt'] = rows as GtfsShapeRow[]
        break
      case 'fare_attributes.txt':
        result['fare_attributes.txt'] = rows as GtfsFareAttributeRow[]
        break
      case 'fare_rules.txt':
        result['fare_rules.txt'] = rows as GtfsFareRuleRow[]
        break
      case 'transfers.txt':
        result['transfers.txt'] = rows as GtfsTransferRow[]
        break
    }
  }

  return result
}
