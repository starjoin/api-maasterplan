export interface GtfsAgencyRow {
  agency_id?: string
  agency_name: string
  agency_url?: string
  agency_timezone?: string
  agency_lang?: string
  agency_phone?: string
  agency_email?: string
}

export interface GtfsStopRow {
  stop_id: string
  stop_code?: string
  stop_name: string
  stop_desc?: string
  stop_lat?: string
  stop_lon?: string
  zone_id?: string
  stop_url?: string
  location_type?: string
  parent_station?: string
  wheelchair_boarding?: string
}

export interface GtfsRouteRow {
  route_id: string
  agency_id?: string
  route_short_name?: string
  route_long_name?: string
  route_desc?: string
  route_type: string
  route_url?: string
  route_color?: string
  route_text_color?: string
  route_sort_order?: string
}

export interface GtfsTripRow {
  route_id: string
  service_id: string
  trip_id: string
  trip_headsign?: string
  trip_short_name?: string
  direction_id?: string
  block_id?: string
  shape_id?: string
  wheelchair_accessible?: string
  bikes_allowed?: string
}

export interface GtfsStopTimeRow {
  trip_id: string
  arrival_time: string
  departure_time: string
  stop_id: string
  stop_sequence: string
  stop_headsign?: string
  pickup_type?: string
  drop_off_type?: string
  shape_dist_traveled?: string
  timepoint?: string
}

export interface GtfsCalendarRow {
  service_id: string
  monday: string
  tuesday: string
  wednesday: string
  thursday: string
  friday: string
  saturday: string
  sunday: string
  start_date: string
  end_date: string
}

export interface GtfsCalendarDateRow {
  service_id: string
  date: string
  exception_type: string
}

export interface GtfsShapeRow {
  shape_id: string
  shape_pt_lat: string
  shape_pt_lon: string
  shape_pt_sequence: string
  shape_dist_traveled?: string
}

export interface GtfsFareAttributeRow {
  fare_id: string
  price?: string
  currency_type?: string
  payment_method?: string
  transfers?: string
  transfer_duration?: string
}

export interface GtfsFareRuleRow {
  fare_id: string
  route_id?: string
  origin_id?: string
  destination_id?: string
  contains_id?: string
}

export interface GtfsTransferRow {
  from_stop_id: string
  to_stop_id: string
  transfer_type: string
  min_transfer_time?: string
}

/** Zones tarifaires (NeTEx FareZone ou dérivé GTFS) */
export interface GtfsFareZoneRow {
  fare_zone_id: string
  fare_zone_name?: string
}

export interface GtfsFiles {
  'agency.txt'?: GtfsAgencyRow[]
  'stops.txt'?: GtfsStopRow[]
  'routes.txt'?: GtfsRouteRow[]
  'trips.txt'?: GtfsTripRow[]
  'stop_times.txt'?: GtfsStopTimeRow[]
  'calendar.txt'?: GtfsCalendarRow[]
  'calendar_dates.txt'?: GtfsCalendarDateRow[]
  'shapes.txt'?: GtfsShapeRow[]
  'fare_attributes.txt'?: GtfsFareAttributeRow[]
  'fare_rules.txt'?: GtfsFareRuleRow[]
  'transfers.txt'?: GtfsTransferRow[]
  /** Non-standard / NeTEx → fare zones */
  'fare_zones.txt'?: GtfsFareZoneRow[]
}

export interface ImportStats {
  agencies: number
  stops: number
  routes: number
  trips: number
  stopTimes: number
  calendars: number
  calendarDates: number
  shapes: number
  fareZones: number
  fareAttributes: number
  fareRules: number
  transfers: number
  pois: number
}

export interface RfuInfo {
  version?: string
  updatedAt?: string
  updated_at?: string
  lastModified?: string
  [key: string]: unknown
}
