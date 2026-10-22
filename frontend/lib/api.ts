import {
  WardFeatureCollection,
  WardFeature,
  StatsResponse,
  QualityReport,
  OSMLayerResponse,
  OSMStatsResponse,
  WardOSMResponse,
} from '@/types/ward';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Fetch ward boundaries. Checks static preloaded asset first if offline or on initial paint,
 * and fetches the latest from the backend with ETag / Cache-Control support.
 */
export async function fetchWards(): Promise<WardFeatureCollection> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/wards`, {
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      return res.json();
    }
  } catch (e) {
    // Fall back to static preloaded file
  }
  
  const fallback = await fetch('/data/wards.json');
  if (!fallback.ok) {
    throw new Error('Failed to load PCMC wards data');
  }
  return fallback.json();
}

/**
 * Fetch summary ward statistics.
 */
export async function fetchStats(): Promise<StatsResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/stats`, {
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      return res.json();
    }
  } catch (e) {
    // Fall back to static preloaded file
  }

  const fallback = await fetch('/data/stats.json');
  if (!fallback.ok) {
    throw new Error('Failed to load PCMC statistics');
  }
  return fallback.json();
}

export async function fetchWardById(wardId: string): Promise<WardFeature> {
  const res = await fetch(`${API_BASE_URL}/api/wards/${encodeURIComponent(wardId)}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ward ${wardId} (${res.status} ${res.statusText})`);
  }
  return res.json();
}

export async function fetchQualityReport(): Promise<QualityReport> {
  const res = await fetch(`${API_BASE_URL}/api/quality`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to load data quality report (${res.status} ${res.statusText})`);
  }
  return res.json();
}

export async function fetchLayer(
  layer: string,
  bbox?: [number, number, number, number],
  limit: number = 8000,
  zoom?: number,
  signal?: AbortSignal
): Promise<OSMLayerResponse> {
  let url = `${API_BASE_URL}/api/layers/${encodeURIComponent(layer)}?limit=${limit}`;
  if (bbox) {
    url += `&bbox=${bbox.join(',')}`;
  }
  if (zoom !== undefined) {
    url += `&zoom=${zoom.toFixed(1)}`;
  }
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new Error(`Failed to load OSM layer ${layer} (${res.status} ${res.statusText})`);
  }
  return res.json();
}

export async function fetchOSMStats(): Promise<OSMStatsResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/osm/stats`, {
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      return res.json();
    }
  } catch (e) {
    // Fallback to static preloaded file
  }

  const fallback = await fetch('/data/osm-stats.json');
  if (fallback.ok) {
    return fallback.json();
  }
  throw new Error('Failed to load OSM statistics');
}

export async function fetchWardOSM(wardId: string): Promise<WardOSMResponse> {
  const res = await fetch(`${API_BASE_URL}/api/wards/${encodeURIComponent(wardId)}/osm`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to load OSM metrics for ward ${wardId} (${res.status} ${res.statusText})`);
  }
  return res.json();
}
