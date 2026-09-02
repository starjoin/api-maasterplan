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

export interface GtfsFiles {
  'agency.txt'?: GtfsAgencyRow[]
  'stops.txt'?: GtfsStopRow[]
  'routes.txt'?: GtfsRouteRow[]
  'trips.txt'?: GtfsTripRow[]
  'stop_times.txt'?: GtfsStopTimeRow[]
  'calendar.txt'?: GtfsCalendarRow[]
  'calendar_dates.txt'?: GtfsCalendarDateRow[]
  'shapes.txt'?: GtfsShapeRow[]
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
}

export interface RfuInfo {
  version?: string
  updatedAt?: string
  updated_at?: string
  lastModified?: string
  [key: string]: unknown
}
