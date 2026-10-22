export interface WardProperties {
  wardnum: number | string;
  name: string;
  zone: string;
  area_km2: number;
  perimeter_km: number;
  compactness: number;
  centroid_lon: number;
  centroid_lat: number;
  // OSM Precomputed metrics
  building_count?: number;
  built_area_km2?: number;
  road_km?: number;
  green_km2?: number;
  building_density?: number;
}

export interface WardGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: any;
}

export interface WardFeature {
  type: 'Feature';
  id: string;
  properties: WardProperties;
  geometry: WardGeometry;
  bbox?: [number, number, number, number];
}

export interface WardFeatureCollection {
  type: 'FeatureCollection';
  features: WardFeature[];
  bbox?: [number, number, number, number];
}

export interface ZoneStat {
  zone: string;
  ward_count: number;
  total_area_km2: number;
  mean_area_km2: number;
  share_of_total_area_pct: number;
}

export interface WardSummary {
  wardnum: number | string;
  name: string;
  zone: string;
  area_km2: number;
  compactness: number;
}

export interface StatsResponse {
  total_wards: number;
  total_area_km2: number;
  mean_area_km2: number;
  min_area_km2: number;
  max_area_km2: number;
  zones: ZoneStat[];
  largest_ward: WardSummary;
  smallest_ward: WardSummary;
}

export interface QualityReport {
  total_features: number;
  invalid_geometries_found: number;
  invalid_geometries_fixed: number;
  overlaps_count: number;
  total_overlap_area_km2: number;
  sum_individual_areas_km2: number;
  union_area_km2: number;
  gap_area_km2: number;
  gap_percentage: number;
  summary: string;
}

export interface HeightMetricConfig {
  id: string;
  label: string;
  unit: string;
  description: string;
  elevationScale: number;
  getValue: (props: WardProperties) => number;
  format: (val: number) => string;
}

/**
 * Extensible configuration array for 3D elevation metrics.
 * Supports: area_km2, building_count, road_km, green_km2, and compactness.
 */
export const HEIGHT_METRICS: HeightMetricConfig[] = [
  {
    id: 'area_km2',
    label: 'Area',
    unit: 'km²',
    description: 'Electoral ward geographic land area',
    elevationScale: 260,
    getValue: (p) => p.area_km2 || 0,
    format: (v) => `${v.toFixed(2)} km²`,
  },
  {
    id: 'building_count',
    label: 'Building Count',
    unit: 'bldgs',
    description: 'Total number of OSM buildings in ward',
    elevationScale: 0.5,
    getValue: (p) => p.building_count || 0,
    format: (v) => `${v.toLocaleString()} bldgs`,
  },
  {
    id: 'road_km',
    label: 'Road Length',
    unit: 'km',
    description: 'Total OSM road network length inside ward',
    elevationScale: 40,
    getValue: (p) => p.road_km || 0,
    format: (v) => `${v.toFixed(2)} km`,
  },
  {
    id: 'green_km2',
    label: 'Green Area',
    unit: 'km²',
    description: 'Total park and open green space in ward',
    elevationScale: 2500,
    getValue: (p) => p.green_km2 || 0,
    format: (v) => `${v.toFixed(3)} km²`,
  },
  {
    id: 'compactness',
    label: 'Compactness',
    unit: 'score',
    description: 'Polsby-Popper score (4π·Area / Perimeter²)',
    elevationScale: 4200,
    getValue: (p) => p.compactness || 0,
    format: (v) => v.toFixed(3),
  },
];

/**
 * Modern curated zone palette for PCMC zones A through F
 */
export const ZONE_COLORS: Record<string, { hex: string; rgb: [number, number, number]; name: string }> = {
  A: { hex: '#3b82f6', rgb: [59, 130, 246], name: 'Zone A (Nigdi / Pradhikaran)' },
  B: { hex: '#10b981', rgb: [16, 185, 129], name: 'Zone B (Chinchwad / Thergaon)' },
  C: { hex: '#f59e0b', rgb: [245, 158, 11], name: 'Zone C (Bhosari / Indrayani)' },
  D: { hex: '#ec4899', rgb: [236, 72, 153], name: 'Zone D (Pimple Saudagar / Wakad)' },
  E: { hex: '#8b5cf6', rgb: [139, 92, 246], name: 'Zone E (Dighi / Charholi)' },
  F: { hex: '#06b6d4', rgb: [6, 182, 212], name: 'Zone F (Talwade / Chikhali)' },
};

export const DEFAULT_ZONE_COLOR: { hex: string; rgb: [number, number, number]; name: string } = {
  hex: '#64748b',
  rgb: [100, 116, 139],
  name: 'Unknown Zone',
};

// --- OSM Types ---

export type OSMLayerId = 'boundary' | 'roads' | 'buildings' | 'parks';

export interface OSMLayerState {
  boundary: boolean;
  roads: boolean;
  buildings: boolean;
  parks: boolean;
}

export interface OSMLayerResponse {
  type: 'FeatureCollection';
  features: any[];
  total_matching: number;
  truncated: boolean;
  limit: number;
  bbox?: [number, number, number, number];
}

export interface ZoneOSMStat {
  zone: string;
  road_km: number;
  building_count: number;
  built_area_km2: number;
  green_km2: number;
  building_density: number;
}

export interface OSMStatsResponse {
  total_road_km: number;
  roads_by_class: Record<string, number>;
  total_buildings: number;
  total_built_area_km2: number;
  total_green_km2: number;
  zones: ZoneOSMStat[];
}

export interface WardOSMResponse {
  wardnum: number | string;
  name: string;
  zone: string;
  building_count: number;
  built_area_km2: number;
  road_km: number;
  green_km2: number;
  building_density: number;
}
