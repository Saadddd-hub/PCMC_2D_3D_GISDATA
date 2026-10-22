from typing import Any, Dict, List, Optional, Union, Literal
from pydantic import BaseModel, Field


class WardProperties(BaseModel):
    wardnum: Union[int, str] = Field(..., description="Electoral ward number/identifier")
    name: str = Field(..., description="Electoral ward name, e.g. '01, Zone F'")
    zone: str = Field(..., description="Zone designation (A through F)")
    area_km2: float = Field(..., description="Calculated area in square kilometers")
    perimeter_km: float = Field(..., description="Calculated perimeter in kilometers")
    compactness: float = Field(..., description="Polsby-Popper compactness score (4*pi*area/perimeter^2)")
    centroid_lon: float = Field(..., description="Ward centroid longitude in WGS84")
    centroid_lat: float = Field(..., description="Ward centroid latitude in WGS84")
    # OSM precomputed metrics
    building_count: Optional[int] = Field(default=0, description="Number of buildings in ward")
    built_area_km2: Optional[float] = Field(default=0.0, description="Total building footprint area in km2")
    road_km: Optional[float] = Field(default=0.0, description="Total road length in ward in km")
    green_km2: Optional[float] = Field(default=0.0, description="Total park/green area in ward in km2")
    building_density: Optional[float] = Field(default=0.0, description="Building density per km2")


class WardGeometry(BaseModel):
    type: str = Field(..., description="Geometry type: Polygon or MultiPolygon")
    coordinates: Any = Field(..., description="Coordinate arrays in EPSG:4326")


class WardFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: Optional[Union[str, int]] = None
    properties: WardProperties
    geometry: WardGeometry
    bbox: Optional[List[float]] = None


class WardFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: List[WardFeature]
    bbox: Optional[List[float]] = None


class ZoneStat(BaseModel):
    zone: str
    ward_count: int
    total_area_km2: float
    mean_area_km2: float
    share_of_total_area_pct: float


class WardSummary(BaseModel):
    wardnum: Union[int, str]
    name: str
    zone: str
    area_km2: float
    compactness: float


class StatsResponse(BaseModel):
    total_wards: int
    total_area_km2: float
    mean_area_km2: float
    min_area_km2: float
    max_area_km2: float
    zones: List[ZoneStat]
    largest_ward: WardSummary
    smallest_ward: WardSummary


class QualityReport(BaseModel):
    total_features: int
    invalid_geometries_found: int
    invalid_geometries_fixed: int
    overlaps_count: int
    total_overlap_area_km2: float
    sum_individual_areas_km2: float
    union_area_km2: float
    gap_area_km2: float
    gap_percentage: float
    summary: str


class HealthResponse(BaseModel):
    status: str
    wards_loaded: int
    projected_crs: str
    version: str = "1.0.0"
    osm_loaded: Optional[Dict[str, int]] = None


# --- OSM Schemas ---

class LayerFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: List[Dict[str, Any]]
    total_matching: int
    truncated: bool = False
    limit: int
    bbox: Optional[List[float]] = None


class ZoneOSMStat(BaseModel):
    zone: str
    road_km: float
    building_count: int
    built_area_km2: float
    green_km2: float
    building_density: float


class OSMStatsResponse(BaseModel):
    total_road_km: float
    roads_by_class: Dict[str, float]
    total_buildings: int
    total_built_area_km2: float
    total_green_km2: float
    zones: List[ZoneOSMStat]


class WardOSMResponse(BaseModel):
    wardnum: Union[int, str]
    name: str
    zone: str
    building_count: int
    built_area_km2: float
    road_km: float
    green_km2: float
    building_density: float
