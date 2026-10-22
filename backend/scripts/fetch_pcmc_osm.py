#!/usr/bin/env python
"""
fetch_pcmc_osm.py  --  Download OSM layers for PCMC from Overpass API.

Usage (from repo root):
    backend\\.venv\\Scripts\\python.exe backend/scripts/fetch_pcmc_osm.py

Writes to: backend/data/osm/{boundary,roads,buildings,parks}.geojson

NOTE: Uses json.dump + shapely.geometry.mapping instead of gdf.to_file()
      to avoid GDAL/pyogrio DLL dependency on Windows.
"""

import json
import math
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
import shapely.geometry

# ── Paths ──────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
WARD_GEOJSON = REPO_ROOT / "pcmc-electoral-wards.geojson"
OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "osm"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── osmnx 2.x settings ────────────────────────────────────────────────────
import osmnx as ox

ox.settings.use_cache = True
ox.settings.log_console = False   # reduce noise; we print ourselves
ox.settings.overpass_url = "https://overpass.openstreetmap.fr/api"
ox.settings.overpass_rate_limit = False
ox.settings.http_user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
ox.settings.http_referer = "https://overpass-turbo.eu/"
ox.settings.requests_timeout = 600
ox.settings.overpass_settings = "[out:json][timeout:600][maxsize:1073741824]"

EPSG_UTM = 32643  # UTM 43N (Pune/Maharashtra)


# ── JSON serialization helpers ─────────────────────────────────────────────

class _GeoEncoder(json.JSONEncoder):
    """Handle numpy scalars and nan values when serializing to GeoJSON."""
    def default(self, obj):
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            v = float(obj)
            return None if math.isnan(v) else v
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

    def encode(self, o):
        # Replace Python nan / inf with null in the final string
        return super().encode(o)


def _clean_val(v):
    """Convert numpy types and NaN to JSON-safe Python types."""
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(v, float):
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, str):
        return v if v not in ("nan", "None", "<NA>") else None
    return v


def save_geojson(gdf: gpd.GeoDataFrame, path: Path, layer: str) -> int:
    """
    Serialize a GeoDataFrame to GeoJSON using shapely mapping + json.dump.
    Does NOT require pyogrio / fiona / GDAL.
    Returns number of features written.
    """
    features = []
    prop_cols = [c for c in gdf.columns if c != "geometry"]

    for _, row in gdf.iterrows():
        geom = row["geometry"]
        if geom is None or geom.is_empty:
            continue
        try:
            geom_dict = shapely.geometry.mapping(geom)
        except Exception:
            continue

        props = {}
        for col in prop_cols:
            props[col] = _clean_val(row[col])

        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": geom_dict,
        })

    fc = {"type": "FeatureCollection", "features": features}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(fc, f, cls=_GeoEncoder, separators=(",", ":"))

    kb = path.stat().st_size / 1024
    print(f"[{layer}] Saved {len(features)} features to {path.name} ({kb:.0f} KB)")
    return len(features)


# ── Helpers ────────────────────────────────────────────────────────────────

def safe_numeric(value, fallback=None):
    """
    Parse a numeric value from a messy OSM string like '12 m', '3;4', '4.5m'.
    Returns float or fallback if unparseable.
    """
    if value is None:
        return fallback
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return fallback
        return float(value)
    s = str(value).strip()
    if s in ("nan", "None", "", "<NA>"):
        return fallback
    s = s.split(";")[0].strip()
    m = re.match(r"^([+-]?\d+(?:\.\d+)?)", s)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return fallback


def load_wards() -> gpd.GeoDataFrame:
    """Load, clean, and return 2-D ward GeoDataFrame."""
    if not WARD_GEOJSON.exists():
        raise FileNotFoundError(f"Ward GeoJSON not found at {WARD_GEOJSON}")
    print(f"[init] Loading wards from {WARD_GEOJSON}")
    with open(WARD_GEOJSON, encoding="utf-8") as f:
        data = json.load(f)
    gdf = gpd.GeoDataFrame.from_features(data["features"], crs="EPSG:4326")
    gdf["geometry"] = gdf["geometry"].apply(shapely.force_2d)
    gdf["geometry"] = gdf["geometry"].apply(shapely.make_valid)
    print(f"[init] {len(gdf)} wards loaded (CRS EPSG:4326)")
    return gdf


def build_boundary(wards_gdf: gpd.GeoDataFrame) -> shapely.Geometry:
    """Union all ward polygons → double-buffer to close slivers → PCMC boundary."""
    union = wards_gdf.geometry.union_all()
    boundary = union.buffer(0.0003).buffer(-0.0003)

    gdf_out = gpd.GeoDataFrame(
        [{"name": "PCMC Municipal Boundary"}],
        geometry=[boundary],
        crs="EPSG:4326",
    )
    out = OUT_DIR / "boundary.geojson"
    save_geojson(gdf_out, out, "boundary")
    return boundary


def fetch_layer(
    zones_gdf: gpd.GeoDataFrame,
    tags: Dict,
    geom_types: List[str],
    layer_name: str,
) -> gpd.GeoDataFrame:
    """
    Fetch OSM features for each zone polygon (chunked to avoid Overpass timeouts).
    Concatenates, deduplicates, and filters by geometry type.
    """
    gdfs = []
    for zone, grp in zones_gdf.groupby("zone"):
        poly = grp.geometry.union_all().buffer(0.001)
        feat = None
        for attempt in range(3):
            try:
                print(f"  [{layer_name}] Zone {zone} (attempt {attempt+1}) ...", end=" ", flush=True)
                feat = ox.features_from_polygon(poly, tags=tags)
                print(f"{len(feat)} features")
                gdfs.append(feat)
                time.sleep(1.0)
                break
            except Exception as exc:
                err_summary = str(exc).split("\n")[0][:120]
                print(f"retry after ({err_summary})")
                time.sleep(3 * (attempt + 1))
        if feat is None:
            print(f"  [{layer_name}] Zone {zone} FAILED after all retries -- skipping")

    if not gdfs:
        print(f"[{layer_name}] No data retrieved.")
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    combined = pd.concat(gdfs)
    combined = combined.reset_index()

    # Deduplicate by OSM element id
    if "id" in combined.columns:
        combined = combined.drop_duplicates(subset=["id"])
    elif "osmid" in combined.columns:
        combined = combined.drop_duplicates(subset=["osmid"])

    gdf = gpd.GeoDataFrame(combined, crs="EPSG:4326")
    mask = gdf.geometry.geom_type.isin(geom_types)
    gdf = gdf[mask & ~gdf.geometry.is_empty & gdf.geometry.notna()].copy()
    print(f"[{layer_name}] {len(gdf)} features after filter/dedup")
    return gdf


# ── Roads ──────────────────────────────────────────────────────────────────

def process_roads(zones_gdf: gpd.GeoDataFrame, boundary_geom: shapely.Geometry) -> None:
    raw = fetch_layer(zones_gdf, {"highway": True}, ["LineString", "MultiLineString"], "roads")
    if raw.empty:
        _save_empty("roads")
        return

    raw_proj = raw.to_crs(epsg=EPSG_UTM)
    raw["length_km"] = (raw_proj.geometry.length / 1000.0).round(4)

    # Build output dataframe with selected columns
    out_rows = []
    for i, row in raw.iterrows():
        osm_id = _get_id(row, i)
        out_rows.append({
            "id": osm_id,
            "name": _str_or_none(row.get("name")),
            "highway": _str_or_none(row.get("highway")),
            "lanes": safe_numeric(row.get("lanes")),
            "surface": _str_or_none(row.get("surface")),
            "oneway": _str_or_none(row.get("oneway")),
            "maxspeed": safe_numeric(row.get("maxspeed")),
            "length_km": float(row.get("length_km", 0.0)),
            "geometry": row["geometry"],
        })

    out_df = gpd.GeoDataFrame(out_rows, crs="EPSG:4326")

    # Clip to PCMC boundary (graceful fallback if clip fails)
    out_df = _safe_clip(out_df, boundary_geom, "roads")

    total_km = out_df["length_km"].sum()
    out = OUT_DIR / "roads.geojson"
    n = save_geojson(out_df, out, "roads")
    _sanity("roads", n, total_km=total_km)


# ── Buildings ──────────────────────────────────────────────────────────────

def process_buildings(zones_gdf: gpd.GeoDataFrame, boundary_geom: shapely.Geometry) -> None:
    raw = fetch_layer(zones_gdf, {"building": True}, ["Polygon", "MultiPolygon"], "buildings")
    if raw.empty:
        _save_empty("buildings")
        return

    raw_proj = raw.to_crs(epsg=EPSG_UTM)
    raw["area_m2"] = raw_proj.geometry.area.round(1)

    out_rows = []
    for i, row in raw.iterrows():
        h = safe_numeric(row.get("height"))
        if h is None:
            lvl = safe_numeric(row.get("building:levels"))
            h = round(lvl * 3.2, 1) if lvl is not None else 6.0
        out_rows.append({
            "id": _get_id(row, i),
            "name": _str_or_none(row.get("name")),
            "building": _str_or_none(row.get("building")),
            "levels": safe_numeric(row.get("building:levels")),
            "height_m": float(h),
            "area_m2": float(row.get("area_m2", 0.0)),
            "amenity": _str_or_none(row.get("amenity")),
            "geometry": row["geometry"],
        })

    out_df = gpd.GeoDataFrame(out_rows, crs="EPSG:4326")
    out_df = _safe_clip(out_df, boundary_geom, "buildings")

    area_km2 = out_df["area_m2"].sum() / 1e6
    out = OUT_DIR / "buildings.geojson"
    n = save_geojson(out_df, out, "buildings")
    _sanity("buildings", n, area_km2=area_km2)

    kb = out.stat().st_size / 1024
    if kb > 50 * 1024:
        print("[buildings] WARNING: File >50 MB -- consider PMTiles (see README)")


# ── Parks ──────────────────────────────────────────────────────────────────

def process_parks(zones_gdf: gpd.GeoDataFrame, boundary_geom: shapely.Geometry) -> None:
    tags = {
        "leisure": ["park", "garden", "playground", "nature_reserve",
                    "recreation_ground", "pitch"],
        "landuse": ["forest", "grass", "recreation_ground",
                    "village_green", "meadow"],
        "natural": ["wood", "scrub", "grassland"],
    }
    raw = fetch_layer(zones_gdf, tags, ["Polygon", "MultiPolygon"], "parks")
    if raw.empty:
        _save_empty("parks")
        return

    raw_proj = raw.to_crs(epsg=EPSG_UTM)
    raw["area_ha"] = (raw_proj.geometry.area / 10000.0).round(4)

    out_rows = []
    for i, row in raw.iterrows():
        out_rows.append({
            "id": _get_id(row, i),
            "name": _str_or_none(row.get("name")),
            "leisure": _str_or_none(row.get("leisure")),
            "landuse": _str_or_none(row.get("landuse")),
            "natural": _str_or_none(row.get("natural")),
            "area_ha": float(row.get("area_ha", 0.0)),
            "geometry": row["geometry"],
        })

    out_df = gpd.GeoDataFrame(out_rows, crs="EPSG:4326")
    out_df = _safe_clip(out_df, boundary_geom, "parks")

    green_km2 = out_df["area_ha"].sum() / 100.0
    out = OUT_DIR / "parks.geojson"
    n = save_geojson(out_df, out, "parks")
    _sanity("parks", n, area_km2=green_km2)


# ── Utilities ──────────────────────────────────────────────────────────────

def _get_id(row: pd.Series, fallback: Any) -> str:
    for col in ("id", "osmid"):
        if col in row.index and row[col] is not None:
            return str(row[col])
    return str(fallback)


def _str_or_none(v) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return None if s in ("nan", "None", "", "<NA>") else s


def _safe_clip(
    gdf: gpd.GeoDataFrame,
    boundary: shapely.Geometry,
    name: str,
) -> gpd.GeoDataFrame:
    """Clip gdf to boundary, falling back to original on error."""
    try:
        clipped = gpd.clip(gdf.set_geometry("geometry"), boundary)
        clipped = clipped[~clipped.geometry.is_empty & clipped.geometry.notna()].copy()
        print(f"  [{name}] {len(clipped)} after clip (was {len(gdf)})")
        return clipped
    except Exception as exc:
        print(f"  [{name}] clip failed ({exc}), returning unclipped")
        return gdf


def _save_empty(layer: str) -> None:
    out = OUT_DIR / f"{layer}.geojson"
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": []}, f)
    print(f"[{layer}] WARNING: empty GeoJSON written")


def _sanity(layer: str, count: int, total_km: float = None, area_km2: float = None) -> None:
    if count < 10:
        print(f"  WARNING [{layer}]: only {count} features -- check network/Overpass")
    if total_km is not None and total_km < 50:
        print(f"  WARNING [{layer}]: only {total_km:.1f} km -- expected >=50 km for PCMC")
    if area_km2 is not None and layer == "buildings" and area_km2 < 2:
        print(f"  WARNING [{layer}]: only {area_km2:.2f} km2 built area -- expected >2 km2")
    if area_km2 is not None and layer == "parks" and area_km2 < 0.5:
        print(f"  WARNING [{layer}]: only {area_km2:.2f} km2 green area -- expected >0.5 km2")


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    t0 = time.time()
    print("=" * 62)
    print("PCMC OSM Layer Fetcher  --  osmnx 2.x / no-GDAL mode")
    print("=" * 62)

    wards = load_wards()
    boundary_geom = build_boundary(wards)

    print("\n[roads] Fetching road network per zone ...")
    process_roads(wards, boundary_geom)

    print("\n[buildings] Fetching building footprints per zone ...")
    process_buildings(wards, boundary_geom)

    print("\n[parks] Fetching parks / green areas per zone ...")
    process_parks(wards, boundary_geom)

    elapsed = (time.time() - t0) / 60
    print(f"\n{'=' * 62}")
    print(f"Done in {elapsed:.1f} min.  Files in: {OUT_DIR}")


if __name__ == "__main__":
    main()
