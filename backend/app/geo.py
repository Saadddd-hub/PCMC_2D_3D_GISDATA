import os
import json
import math
import logging
import collections
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Set

import orjson
import geopandas as gpd
import pandas as pd
import shapely
import shapely.geometry
from pyproj import Transformer

logger = logging.getLogger("pcmc.geo")

# Target projected CRS for PCMC (Pune / Maharashtra UTM zone 43N)
PROJECTED_EPSG = 32643
WGS84_EPSG = 4326


def find_geojson_path() -> Path:
    """
    Search for pcmc-electoral-wards.geojson in several possible locations.
    Never modifies original files.
    """
    candidates = [
        Path("pcmc-electoral-wards.geojson"),
        Path("data/pcmc-electoral-wards.geojson"),
        Path("../pcmc-electoral-wards.geojson"),
        Path("../data/pcmc-electoral-wards.geojson"),
        Path(__file__).resolve().parent.parent.parent / "pcmc-electoral-wards.geojson",
        Path(__file__).resolve().parent.parent.parent / "data" / "pcmc-electoral-wards.geojson",
        Path(__file__).resolve().parent.parent / "data" / "pcmc-wards-processed.geojson",
    ]
    for p in candidates:
        if p.exists() and p.is_file():
            return p.resolve()
    raise FileNotFoundError("Could not find pcmc-electoral-wards.geojson in workspace.")


def get_osm_data_dir() -> Path:
    """
    Returns path to backend/data/osm directory.
    """
    candidates = [
        Path("backend/data/osm"),
        Path("data/osm"),
        Path(__file__).resolve().parent.parent / "data" / "osm",
        Path(__file__).resolve().parent.parent.parent / "backend" / "data" / "osm",
    ]
    for p in candidates:
        if p.exists() and p.is_dir():
            return p.resolve()
    # Default to standard path
    p = Path(__file__).resolve().parent.parent / "data" / "osm"
    p.mkdir(parents=True, exist_ok=True)
    return p.resolve()


def round_coordinates(coords: Any, decimals: int = 6) -> Any:
    """
    Recursively round coordinates to specified decimal places (6 decimals ~ 0.1m).
    """
    if isinstance(coords, (int, float)):
        return round(float(coords), decimals)
    if isinstance(coords, (list, tuple)):
        return [round_coordinates(c, decimals) for c in coords]
    return coords


def extract_polygon_geometry(geom: shapely.Geometry) -> shapely.Geometry:
    """
    Ensures the geometry is Polygon or MultiPolygon.
    If make_valid produced a GeometryCollection, extracts only polygon parts.
    """
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    if geom.geom_type == "GeometryCollection":
        polys = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        if len(polys) == 1:
            return polys[0]
        elif len(polys) > 1:
            return shapely.MultiPolygon([p for poly in polys for p in (poly.geoms if poly.geom_type == "MultiPolygon" else [poly])])
    return geom


class PCMCGeoProcessor:
    def __init__(self):
        self.gdf_wgs84: Optional[gpd.GeoDataFrame] = None
        self.gdf_proj: Optional[gpd.GeoDataFrame] = None
        self.feature_collection: Optional[Dict[str, Any]] = None
        self.stats: Optional[Dict[str, Any]] = None
        self.quality_report: Optional[Dict[str, Any]] = None
        self.ward_index: Dict[str, Dict[str, Any]] = {}
        
        # OSM Layers and summaries
        self.osm_layers: Dict[str, gpd.GeoDataFrame] = {}
        self.osm_sindex: Dict[str, Any] = {}
        self.osm_stats: Optional[Dict[str, Any]] = None
        self.ward_osm_map: Dict[str, Dict[str, Any]] = {}

        # High-performance prebuilt features and LRU query cache
        self.prebuilt_features: Dict[str, List[Dict[str, Any]]] = {}
        self.simplified_roads: List[Dict[str, Any]] = []
        self._bbox_lru_cache: collections.OrderedDict = collections.OrderedDict()

    def load_and_process(self) -> None:
        raw_path = find_geojson_path()
        logger.info(f"Loading raw ward GeoJSON from {raw_path}")

        with open(raw_path, "r", encoding="utf-8") as f:
            raw_data = json.load(f)

        features = raw_data.get("features", [])
        if not features:
            raise ValueError("No features found in GeoJSON input.")

        # Load into GeoPandas
        gdf = gpd.GeoDataFrame.from_features(features, crs=f"EPSG:{WGS84_EPSG}")
        total_features = len(gdf)

        # 1. Drop Z values and fix invalid geometries
        invalid_found = 0
        invalid_fixed = 0

        clean_geoms = []
        for idx, geom in enumerate(gdf.geometry):
            g2d = shapely.force_2d(geom)
            if not g2d.is_valid:
                invalid_found += 1
                fixed = shapely.make_valid(g2d)
                fixed = extract_polygon_geometry(fixed)
                if fixed.is_valid:
                    invalid_fixed += 1
                clean_geoms.append(fixed)
            else:
                clean_geoms.append(g2d)

        gdf["geometry"] = clean_geoms

        # 2. Project to EPSG:32643 (UTM 43N) for accurate metric calculations
        gdf_proj = gdf.to_crs(epsg=PROJECTED_EPSG)

        areas_m2 = gdf_proj.geometry.area
        perimeters_m = gdf_proj.geometry.length

        # area in km2, perimeter in km
        gdf["area_km2"] = (areas_m2 / 1_000_000.0).round(4)
        gdf["perimeter_km"] = (perimeters_m / 1_000.0).round(4)

        # compactness = 4 * pi * area / perimeter^2 (Polsby-Popper score)
        compactness_vals = []
        for a, p in zip(areas_m2, perimeters_m):
            if p > 0:
                score = (4.0 * math.pi * a) / (p ** 2)
                compactness_vals.append(round(score, 4))
            else:
                compactness_vals.append(0.0)
        gdf["compactness"] = compactness_vals

        # Centroid in projected CRS, then transform to EPSG:4326 for lon/lat
        centroids_proj = gdf_proj.geometry.centroid
        centroids_4326 = centroids_proj.to_crs(epsg=WGS84_EPSG)
        gdf["centroid_lon"] = centroids_4326.x.round(6)
        gdf["centroid_lat"] = centroids_4326.y.round(6)

        self.gdf_wgs84 = gdf
        self.gdf_proj = gdf_proj

        # 3. Load OSM layers if available
        self._load_osm_layers()

        # 4. Precompute per-ward OSM spatial summaries
        self._compute_ward_osm_summaries()

        # 5. Compute Data Quality (overlaps & gaps)
        self._compute_quality_report(invalid_found, invalid_fixed)

        # 6. Compute Ward & OSM Statistics
        self._compute_statistics()
        self._compute_osm_statistics()

        # 7. Build GeoJSON FeatureCollection with rounded coordinates
        self._build_feature_collection()

        # 8. Save derived dataset to backend/data/
        self._save_derived_data()

    def _load_osm_layers(self) -> None:
        """
        Loads OSM GeoJSON layers (boundary, roads, buildings, parks) from backend/data/osm.
        Builds spatial indexes for fast viewport queries and prebuilds feature dictionaries.
        """
        osm_dir = get_osm_data_dir()
        layer_names = ["boundary", "roads", "buildings", "parks"]
        
        KEEP_COLS = {
            "boundary": ["name"],
            "roads": ["id", "name", "highway", "lanes", "surface", "oneway", "maxspeed", "length_km"],
            "buildings": ["id", "name", "building", "levels", "height_m", "area_m2"],
            "parks": ["id", "name", "leisure", "landuse", "natural", "area_ha"],
        }
        
        for name in layer_names:
            file_path = osm_dir / f"{name}.geojson"
            if file_path.exists() and file_path.stat().st_size > 50:
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    feats = data.get("features", [])
                    if feats:
                        gdf_layer = gpd.GeoDataFrame.from_features(feats, crs=f"EPSG:{WGS84_EPSG}")
                        gdf_layer["geometry"] = gdf_layer["geometry"].apply(shapely.force_2d)
                        gdf_layer["geometry"] = gdf_layer["geometry"].apply(shapely.make_valid)
                        gdf_layer = gdf_layer[~gdf_layer.geometry.is_empty & gdf_layer.geometry.notna()].copy()
                        
                        self.osm_layers[name] = gdf_layer
                        self.osm_sindex[name] = gdf_layer.sindex
                        logger.info(f"Loaded OSM layer '{name}': {len(gdf_layer)} features")
                    else:
                        self.osm_layers[name] = gpd.GeoDataFrame(geometry=[], crs=f"EPSG:{WGS84_EPSG}")
                        logger.warning(f"OSM layer '{name}' is empty")
                except Exception as e:
                    logger.error(f"Failed to load OSM layer '{name}': {e}")
                    self.osm_layers[name] = gpd.GeoDataFrame(geometry=[], crs=f"EPSG:{WGS84_EPSG}")
            else:
                self.osm_layers[name] = gpd.GeoDataFrame(geometry=[], crs=f"EPSG:{WGS84_EPSG}")
                logger.info(f"OSM layer '{name}' not found at {file_path}")

        # Prebuild feature dictionaries with 5-decimal coordinates and pruned columns
        for name, gdf_layer in self.osm_layers.items():
            if gdf_layer.empty:
                self.prebuilt_features[name] = []
                continue
            cols_to_keep = [c for c in KEEP_COLS.get(name, []) if c in gdf_layer.columns]
            
            prebuilt_list = []
            is_roads = (name == "roads")
            simplified_list = [] if is_roads else None
            
            geoms = gdf_layer.geometry.values
            recs = gdf_layer[cols_to_keep].to_dict(orient="records") if cols_to_keep else [{} for _ in range(len(gdf_layer))]
            
            for idx in range(len(gdf_layer)):
                geom = geoms[idx]
                props = {k: (None if (pd.isna(v) or v is None) else v) for k, v in recs[idx].items()}
                feat_id = str(props.get("id", idx))
                
                g_dict = shapely.geometry.mapping(geom)
                g_dict["coordinates"] = round_coordinates(g_dict["coordinates"], decimals=5)
                
                feat = {
                    "type": "Feature",
                    "id": feat_id,
                    "properties": props,
                    "geometry": g_dict,
                }
                prebuilt_list.append(feat)
                
                if is_roads:
                    g_simp = shapely.simplify(geom, tolerance=0.0002, preserve_topology=False)
                    g_simp_dict = shapely.geometry.mapping(g_simp)
                    g_simp_dict["coordinates"] = round_coordinates(g_simp_dict["coordinates"], decimals=5)
                    simplified_list.append({
                        "type": "Feature",
                        "id": feat_id,
                        "properties": props,
                        "geometry": g_simp_dict,
                    })
                    
            self.prebuilt_features[name] = prebuilt_list
            if is_roads:
                self.simplified_roads = simplified_list
            logger.info(f"Prebuilt {len(prebuilt_list)} features for layer '{name}'")

    def _compute_ward_osm_summaries(self) -> None:
        """
        Precomputes spatial join per ward:
        - building_count
        - built_area_km2
        - road_km (roads clipped to ward)
        - green_km2 (parks in ward)
        - building_density
        """
        gdf_proj = self.gdf_proj
        gdf_wgs84 = self.gdf_wgs84
        n_wards = len(gdf_wgs84)
        
        building_counts = [0] * n_wards
        built_areas = [0.0] * n_wards
        road_kms = [0.0] * n_wards
        green_kms = [0.0] * n_wards
        densities = [0.0] * n_wards
        
        self.ward_osm_map.clear()

        # 1. Road km per ward (clip in UTM 43N)
        roads_gdf = self.osm_layers.get("roads")
        if roads_gdf is not None and not roads_gdf.empty:
            roads_proj = roads_gdf.to_crs(epsg=PROJECTED_EPSG)
            roads_sindex = roads_proj.sindex
            
            for idx, ward_geom in enumerate(gdf_proj.geometry):
                cand_idx = list(roads_sindex.intersection(ward_geom.bounds))
                if cand_idx:
                    cands = roads_proj.iloc[cand_idx]
                    inter = cands.geometry.intersection(ward_geom)
                    inter_lines = inter[~inter.is_empty]
                    tot_len_km = round(float(inter_lines.length.sum() / 1000.0), 3)
                    road_kms[idx] = tot_len_km

        # 2. Buildings per ward (assign via building centroid in UTM 43N)
        bldgs_gdf = self.osm_layers.get("buildings")
        if bldgs_gdf is not None and not bldgs_gdf.empty:
            bldgs_proj = bldgs_gdf.to_crs(epsg=PROJECTED_EPSG)
            bldgs_centroids = bldgs_proj.geometry.centroid
            bldgs_sindex = bldgs_proj.sindex
            
            for idx, ward_geom in enumerate(gdf_proj.geometry):
                cand_idx = list(bldgs_sindex.intersection(ward_geom.bounds))
                if cand_idx:
                    cand_cents = bldgs_centroids.iloc[cand_idx]
                    in_ward_mask = cand_cents.within(ward_geom)
                    count = int(in_ward_mask.sum())
                    building_counts[idx] = count
                    
                    if count > 0:
                        in_ward_bldgs = bldgs_proj.iloc[cand_idx][in_ward_mask]
                        if "area_m2" in in_ward_bldgs.columns:
                            tot_m2 = float(in_ward_bldgs["area_m2"].sum())
                        else:
                            tot_m2 = float(in_ward_bldgs.geometry.area.sum())
                        built_areas[idx] = round(tot_m2 / 1_000_000.0, 4)

        # 3. Parks / Green area per ward (UTM 43N)
        parks_gdf = self.osm_layers.get("parks")
        if parks_gdf is not None and not parks_gdf.empty:
            parks_proj = parks_gdf.to_crs(epsg=PROJECTED_EPSG)
            parks_sindex = parks_proj.sindex
            
            for idx, ward_geom in enumerate(gdf_proj.geometry):
                cand_idx = list(parks_sindex.intersection(ward_geom.bounds))
                if cand_idx:
                    cands = parks_proj.iloc[cand_idx]
                    inter = cands.geometry.intersection(ward_geom)
                    inter_polys = inter[~inter.is_empty]
                    green_kms[idx] = round(float(inter_polys.area.sum() / 1_000_000.0), 4)

        # 4. Building density = building_count / area_km2
        for idx in range(n_wards):
            area = gdf_wgs84["area_km2"].iloc[idx]
            cnt = building_counts[idx]
            densities[idx] = round(cnt / area, 2) if area > 0 else 0.0

        gdf_wgs84["building_count"] = building_counts
        gdf_wgs84["built_area_km2"] = built_areas
        gdf_wgs84["road_km"] = road_kms
        gdf_wgs84["green_km2"] = green_kms
        gdf_wgs84["building_density"] = densities

        # Build lookup map for fast /api/wards/{id}/osm queries
        for idx, row in gdf_wgs84.iterrows():
            ward_num_str = str(row["wardnum"])
            summary_dict = {
                "wardnum": row["wardnum"],
                "name": str(row["name"]),
                "zone": str(row["zone"]),
                "building_count": int(row["building_count"]),
                "built_area_km2": float(row["built_area_km2"]),
                "road_km": float(row["road_km"]),
                "green_km2": float(row["green_km2"]),
                "building_density": float(row["building_density"]),
            }
            self.ward_osm_map[ward_num_str] = summary_dict
            self.ward_osm_map[str(row["name"]).strip().lower()] = summary_dict

        logger.info(f"Precomputed OSM metrics for {n_wards} wards. Total roads: {sum(road_kms):.1f} km, buildings: {sum(building_counts):,}")

    def _compute_osm_statistics(self) -> None:
        """
        Aggregate OSM statistics across city and per-zone.
        """
        roads_gdf = self.osm_layers.get("roads")
        bldgs_gdf = self.osm_layers.get("buildings")
        parks_gdf = self.osm_layers.get("parks")
        gdf = self.gdf_wgs84

        total_road_km = round(float(gdf["road_km"].sum()), 2)
        total_buildings = int(gdf["building_count"].sum())
        total_built_area_km2 = round(float(gdf["built_area_km2"].sum()), 3)
        total_green_km2 = round(float(gdf["green_km2"].sum()), 3)

        # Roads breakdown by highway class
        roads_by_class: Dict[str, float] = {}
        if roads_gdf is not None and not roads_gdf.empty and "highway" in roads_gdf.columns:
            for hw, group in roads_gdf.groupby("highway"):
                hw_str = str(hw)
                if "length_km" in group.columns:
                    km = round(float(group["length_km"].sum()), 2)
                else:
                    km = 0.0
                roads_by_class[hw_str] = km

        # Zone-level OSM metrics
        zone_osm_stats = []
        for zone_name, grp in sorted(gdf.groupby("zone")):
            z_road_km = round(float(grp["road_km"].sum()), 2)
            z_bldg_cnt = int(grp["building_count"].sum())
            z_built_km2 = round(float(grp["built_area_km2"].sum()), 3)
            z_green_km2 = round(float(grp["green_km2"].sum()), 3)
            z_area = float(grp["area_km2"].sum())
            z_density = round(z_bldg_cnt / z_area, 2) if z_area > 0 else 0.0

            zone_osm_stats.append({
                "zone": str(zone_name),
                "road_km": z_road_km,
                "building_count": z_bldg_cnt,
                "built_area_km2": z_built_km2,
                "green_km2": z_green_km2,
                "building_density": z_density,
            })

        self.osm_stats = {
            "total_road_km": total_road_km,
            "roads_by_class": roads_by_class,
            "total_buildings": total_buildings,
            "total_built_area_km2": total_built_area_km2,
            "total_green_km2": total_green_km2,
            "zones": zone_osm_stats,
        }

    def _compute_quality_report(self, invalid_found: int, invalid_fixed: int) -> None:
        gdf_proj = self.gdf_proj
        total_features = len(gdf_proj)

        # Overlap analysis using spatial index
        overlaps = []
        sindex = gdf_proj.sindex
        geoms = gdf_proj.geometry.values
        wardnums = self.gdf_wgs84["wardnum"].values

        total_overlap_area_m2 = 0.0

        for i, geom_i in enumerate(geoms):
            possible_matches = sindex.intersection(geom_i.bounds)
            for j in possible_matches:
                if i < j:
                    geom_j = geoms[j]
                    inter = geom_i.intersection(geom_j)
                    if hasattr(inter, "area") and inter.area > 1.0:
                        total_overlap_area_m2 += inter.area
                        overlaps.append({
                            "ward_a": str(wardnums[i]),
                            "ward_b": str(wardnums[j]),
                            "overlap_area_m2": round(inter.area, 2),
                        })

        total_overlap_area_km2 = round(total_overlap_area_m2 / 1_000_000.0, 6)

        # Union vs sum of areas for gaps check
        union_geom = gdf_proj.geometry.union_all()
        union_area_km2 = round(union_geom.area / 1_000_000.0, 4)
        sum_individual_area_km2 = round(self.gdf_wgs84["area_km2"].sum(), 4)
        gap_area_km2 = round(abs(sum_individual_area_km2 - union_area_km2), 4)
        gap_pct = round((gap_area_km2 / union_area_km2) * 100.0, 4) if union_area_km2 > 0 else 0.0

        summary = (
            f"Quality Check Completed: {total_features} wards verified in UTM 43N. "
            f"{invalid_found} invalid geometries found ({invalid_fixed} fixed). "
            f"{len(overlaps)} boundary sliver overlaps detected totaling {total_overlap_area_km2} km². "
            f"Sum of individual areas is {sum_individual_area_km2} km² vs dissolved union {union_area_km2} km² "
            f"(gap: {gap_area_km2} km² or {gap_pct}%)."
        )

        logger.info(summary)

        self.quality_report = {
            "total_features": total_features,
            "invalid_geometries_found": invalid_found,
            "invalid_geometries_fixed": invalid_fixed,
            "overlaps_count": len(overlaps),
            "total_overlap_area_km2": total_overlap_area_km2,
            "sum_individual_areas_km2": sum_individual_area_km2,
            "union_area_km2": union_area_km2,
            "gap_area_km2": gap_area_km2,
            "gap_percentage": gap_pct,
            "summary": summary,
        }

    def _compute_statistics(self) -> None:
        gdf = self.gdf_wgs84
        total_wards = len(gdf)
        total_area = round(float(gdf["area_km2"].sum()), 4)
        mean_area = round(float(gdf["area_km2"].mean()), 4)
        min_area = round(float(gdf["area_km2"].min()), 4)
        max_area = round(float(gdf["area_km2"].max()), 4)

        zone_groups = gdf.groupby("zone")
        zone_stats = []
        for zone_name, group in sorted(zone_groups):
            z_count = len(group)
            z_total = round(float(group["area_km2"].sum()), 4)
            z_mean = round(float(group["area_km2"].mean()), 4)
            share_pct = round((z_total / total_area) * 100.0, 2) if total_area > 0 else 0.0
            zone_stats.append({
                "zone": str(zone_name),
                "ward_count": z_count,
                "total_area_km2": z_total,
                "mean_area_km2": z_mean,
                "share_of_total_area_pct": share_pct,
            })

        idx_max = gdf["area_km2"].idxmax()
        row_max = gdf.loc[idx_max]
        largest_ward = {
            "wardnum": row_max["wardnum"],
            "name": str(row_max["name"]),
            "zone": str(row_max["zone"]),
            "area_km2": float(row_max["area_km2"]),
            "compactness": float(row_max["compactness"]),
        }

        idx_min = gdf["area_km2"].idxmin()
        row_min = gdf.loc[idx_min]
        smallest_ward = {
            "wardnum": row_min["wardnum"],
            "name": str(row_min["name"]),
            "zone": str(row_min["zone"]),
            "area_km2": float(row_min["area_km2"]),
            "compactness": float(row_min["compactness"]),
        }

        self.stats = {
            "total_wards": total_wards,
            "total_area_km2": total_area,
            "mean_area_km2": mean_area,
            "min_area_km2": min_area,
            "max_area_km2": max_area,
            "zones": zone_stats,
            "largest_ward": largest_ward,
            "smallest_ward": smallest_ward,
        }

    def _build_feature_collection(self) -> None:
        gdf = self.gdf_wgs84
        features = []
        self.ward_index.clear()

        minx, miny, maxx, maxy = gdf.total_bounds
        bbox = [round(minx, 6), round(miny, 6), round(maxx, 6), round(maxy, 6)]

        for _, row in gdf.iterrows():
            geom_dict = shapely.geometry.mapping(row["geometry"])
            geom_dict["coordinates"] = round_coordinates(geom_dict["coordinates"], decimals=6)

            f_minx, f_miny, f_maxx, f_maxy = row["geometry"].bounds
            f_bbox = [round(f_minx, 6), round(f_miny, 6), round(f_maxx, 6), round(f_maxy, 6)]

            props = {
                "wardnum": row["wardnum"],
                "name": str(row["name"]),
                "zone": str(row["zone"]),
                "area_km2": float(row["area_km2"]),
                "perimeter_km": float(row["perimeter_km"]),
                "compactness": float(row["compactness"]),
                "centroid_lon": float(row["centroid_lon"]),
                "centroid_lat": float(row["centroid_lat"]),
                # Precomputed OSM metrics
                "building_count": int(row.get("building_count", 0)),
                "built_area_km2": float(row.get("built_area_km2", 0.0)),
                "road_km": float(row.get("road_km", 0.0)),
                "green_km2": float(row.get("green_km2", 0.0)),
                "building_density": float(row.get("building_density", 0.0)),
            }

            ward_id = str(row["wardnum"])
            feature = {
                "type": "Feature",
                "id": ward_id,
                "properties": props,
                "geometry": geom_dict,
                "bbox": f_bbox,
            }
            features.append(feature)

            self.ward_index[ward_id] = feature
            self.ward_index[str(row["name"]).strip().lower()] = feature

        self.feature_collection = {
            "type": "FeatureCollection",
            "features": features,
            "bbox": bbox,
        }

    def _save_derived_data(self) -> None:
        out_dir = Path(__file__).resolve().parent.parent / "data"
        out_dir.mkdir(parents=True, exist_ok=True)

        out_geojson = out_dir / "pcmc-wards-processed.geojson"
        with open(out_geojson, "wb") as f:
            f.write(orjson.dumps(self.feature_collection, option=orjson.OPT_SERIALIZE_NUMPY))

        out_quality = out_dir / "quality-report.json"
        with open(out_quality, "wb") as f:
            f.write(orjson.dumps(self.quality_report, option=orjson.OPT_SERIALIZE_NUMPY))

        out_stats = out_dir / "stats.json"
        with open(out_stats, "wb") as f:
            f.write(orjson.dumps(self.stats, option=orjson.OPT_SERIALIZE_NUMPY))

        if self.osm_stats:
            out_osm_stats = out_dir / "osm-stats.json"
            with open(out_osm_stats, "wb") as f:
                f.write(orjson.dumps(self.osm_stats, option=orjson.OPT_SERIALIZE_NUMPY))

        # Also write static preloaded assets for Next.js frontend public/data/
        frontend_data = Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "data"
        frontend_data.mkdir(parents=True, exist_ok=True)
        try:
            with open(frontend_data / "wards.json", "wb") as f:
                f.write(orjson.dumps(self.feature_collection, option=orjson.OPT_SERIALIZE_NUMPY))
            with open(frontend_data / "stats.json", "wb") as f:
                f.write(orjson.dumps(self.stats, option=orjson.OPT_SERIALIZE_NUMPY))
            if self.osm_stats:
                with open(frontend_data / "osm-stats.json", "wb") as f:
                    f.write(orjson.dumps(self.osm_stats, option=orjson.OPT_SERIALIZE_NUMPY))
            logger.info(f"Saved derived datasets to {out_dir} and static frontend assets to {frontend_data}")
        except Exception as e:
            logger.warning(f"Could not write frontend static assets: {e}")

    def get_feature_collection(self) -> Dict[str, Any]:
        if not self.feature_collection:
            self.load_and_process()
        return self.feature_collection

    def get_stats(self) -> Dict[str, Any]:
        if not self.stats:
            self.load_and_process()
        return self.stats

    def get_quality_report(self) -> Dict[str, Any]:
        if not self.quality_report:
            self.load_and_process()
        return self.quality_report

    def get_ward(self, ward_id: str) -> Optional[Dict[str, Any]]:
        if not self.ward_index:
            self.load_and_process()
        
        clean_key = str(ward_id).strip()
        if clean_key in self.ward_index:
            return self.ward_index[clean_key]
        
        lower_key = clean_key.lower()
        if lower_key in self.ward_index:
            return self.ward_index[lower_key]
        
        return None

    def get_layer_bbox(
        self,
        layer_name: str,
        minx: float,
        miny: float,
        maxx: float,
        maxy: float,
        limit: int = 8000,
        zoom: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Ultra-fast OSM layer viewport bounding box query.
        Uses in-memory spatial index (RTree) and prebuilt feature dictionary slicing.
        Enforces feature limit with LRU caching and zoom-based simplification.
        """
        layer_name = layer_name.lower().strip()
        if layer_name not in ("boundary", "roads", "buildings", "parks"):
            raise ValueError(f"Unknown layer '{layer_name}'. Valid layers: boundary, roads, buildings, parks.")

        if minx > maxx or miny > maxy:
            raise ValueError(f"Invalid bbox coordinates: min values must be <= max values ({minx}, {miny}, {maxx}, {maxy})")

        # Check in-memory LRU cache (bucketed to ~100m coordinate precision)
        z_bucket = int(zoom) if zoom is not None else 14
        cache_key = (layer_name, round(minx, 3), round(miny, 3), round(maxx, 3), round(maxy, 3), z_bucket, limit)
        if cache_key in self._bbox_lru_cache:
            self._bbox_lru_cache.move_to_end(cache_key)
            return self._bbox_lru_cache[cache_key]

        gdf_layer = self.osm_layers.get(layer_name)
        if gdf_layer is None or gdf_layer.empty:
            self._load_osm_layers()
            gdf_layer = self.osm_layers.get(layer_name)

        prebuilt = self.prebuilt_features.get(layer_name, [])
        if gdf_layer is None or gdf_layer.empty or not prebuilt:
            return {
                "type": "FeatureCollection",
                "features": [],
                "total_matching": 0,
                "truncated": False,
                "limit": limit,
                "bbox": [round(minx, 5), round(miny, 5), round(maxx, 5), round(maxy, 5)],
            }

        sindex = self.osm_sindex.get(layer_name)
        bbox_geom = shapely.geometry.box(minx, miny, maxx, maxy)

        if sindex is not None:
            cand_idx = list(sindex.intersection((minx, miny, maxx, maxy)))
            if not cand_idx:
                result = {
                    "type": "FeatureCollection",
                    "features": [],
                    "total_matching": 0,
                    "truncated": False,
                    "limit": limit,
                    "bbox": [round(minx, 5), round(miny, 5), round(maxx, 5), round(maxy, 5)],
                }
                if len(self._bbox_lru_cache) >= 256:
                    self._bbox_lru_cache.popitem(last=False)
                self._bbox_lru_cache[cache_key] = result
                return result

            candidates = gdf_layer.iloc[cand_idx]
            match_mask = candidates.intersects(bbox_geom)
            matched_indices = [cand_idx[i] for i, m in enumerate(match_mask) if m]
        else:
            match_mask = gdf_layer.intersects(bbox_geom)
            matched_indices = [i for i, m in enumerate(match_mask) if m]

        total_matching = len(matched_indices)
        truncated = total_matching > limit
        sliced_indices = matched_indices[:limit]

        # Use simplified roads if zoom < 13
        use_simplified_roads = (layer_name == "roads" and zoom is not None and zoom < 13 and bool(self.simplified_roads))
        features = []
        for i in sliced_indices:
            if i < len(prebuilt):
                if use_simplified_roads and i < len(self.simplified_roads):
                    features.append(self.simplified_roads[i])
                else:
                    features.append(prebuilt[i])

        result = {
            "type": "FeatureCollection",
            "features": features,
            "total_matching": total_matching,
            "truncated": truncated,
            "limit": limit,
            "bbox": [round(minx, 5), round(miny, 5), round(maxx, 5), round(maxy, 5)],
        }

        if len(self._bbox_lru_cache) >= 256:
            self._bbox_lru_cache.popitem(last=False)
        self._bbox_lru_cache[cache_key] = result
        return result

    def get_osm_stats(self) -> Dict[str, Any]:
        """
        Returns aggregate OSM road km by class, building count, built area, and zone totals.
        """
        if self.osm_stats is None:
            self._compute_osm_statistics()
        return self.osm_stats or {
            "total_road_km": 0.0,
            "roads_by_class": {},
            "total_buildings": 0,
            "total_built_area_km2": 0.0,
            "total_green_km2": 0.0,
            "zones": [],
        }

    def get_ward_osm(self, ward_id: str) -> Optional[Dict[str, Any]]:
        """
        Returns precomputed per-ward OSM metrics summary.
        """
        if not self.ward_osm_map:
            self.load_and_process()
            
        clean_key = str(ward_id).strip()
        if clean_key in self.ward_osm_map:
            return self.ward_osm_map[clean_key]
            
        lower_key = clean_key.lower()
        if lower_key in self.ward_osm_map:
            return self.ward_osm_map[lower_key]
            
        return None


# Global singleton processor
processor = PCMCGeoProcessor()
