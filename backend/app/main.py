import hashlib
import logging
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional

import orjson
from fastapi import FastAPI, HTTPException, Path as FastApiPath, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.geo import processor
from app.schemas import (
    WardFeatureCollection,
    WardFeature,
    StatsResponse,
    QualityReport,
    HealthResponse,
    LayerFeatureCollection,
    OSMStatsResponse,
    WardOSMResponse,
)


class FastORJSONResponse(Response):
    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return orjson.dumps(content, option=orjson.OPT_SERIALIZE_NUMPY)


def make_etag_response(
    content: Any,
    request: Request,
    max_age: int = 3600,
) -> Response:
    body = orjson.dumps(content, option=orjson.OPT_SERIALIZE_NUMPY)
    etag = f'"{hashlib.md5(body).hexdigest()}"'

    client_etag = request.headers.get("if-none-match")
    if client_etag and (client_etag == etag or client_etag == f"W/{etag}"):
        return Response(
            status_code=status.HTTP_304_NOT_MODIFIED,
            headers={
                "ETag": etag,
                "Cache-Control": f"public, max-age={max_age}",
            },
        )

    return Response(
        content=body,
        media_type="application/json",
        headers={
            "ETag": etag,
            "Cache-Control": f"public, max-age={max_age}",
        },
    )

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("pcmc.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Load and process GeoJSON & OSM Layers
    logger.info("Initializing PCMC GIS processing engine...")
    try:
        processor.load_and_process()
        report = processor.get_quality_report()
        logger.info(f"Startup complete: {report['summary']}")
    except Exception as e:
        logger.error(f"Failed to load PCMC GIS data: {e}", exc_info=True)
        raise e
    yield
    logger.info("Shutting down PCMC GIS service.")


app = FastAPI(
    title="PCMC Electoral Wards & OSM GIS API",
    description="Spatial analysis and high-performance vector GIS service for Pimpri-Chinchwad Municipal Corporation (PCMC) boundaries, roads, buildings, and parks.",
    version="2.0.0",
    lifespan=lifespan,
    default_response_class=FastORJSONResponse,
)

# Enable CORS for Next.js frontend
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "*"
]

# GZip compress responses >= 1 KB — critical for large layer GeoJSON payloads
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse, tags=["System"])
def get_health():
    """
    Health check returning status, number of loaded wards, and OSM feature counts.
    """
    fc = processor.get_feature_collection()
    osm_counts = {
        name: len(gdf) for name, gdf in processor.osm_layers.items()
    }
    return HealthResponse(
        status="ok",
        wards_loaded=len(fc["features"]),
        projected_crs="EPSG:32643 (UTM 43N)",
        version="2.0.0",
        osm_loaded=osm_counts,
    )


@app.get("/api/wards", response_model=WardFeatureCollection, tags=["Wards"])
def get_wards(request: Request):
    """
    Returns PCMC electoral wards as a GeoJSON FeatureCollection with Cache-Control & ETag.
    """
    return make_etag_response(processor.get_feature_collection(), request, max_age=3600)


@app.get("/api/stats", response_model=StatsResponse, tags=["Analytics"])
def get_stats(request: Request):
    """
    Returns aggregate ward statistics with Cache-Control & ETag.
    """
    return make_etag_response(processor.get_stats(), request, max_age=3600)


@app.get("/api/wards/{ward_id}", response_model=WardFeature, tags=["Wards"])
def get_ward_by_id(
    request: Request,
    ward_id: str = FastApiPath(..., description="Electoral ward identifier (e.g. '1', '64_1', or ward name)")
):
    """
    Returns a single ward's GeoJSON feature with complete geometry and metrics.
    """
    ward = processor.get_ward(ward_id)
    if not ward:
        raise HTTPException(
            status_code=404,
            detail=f"Ward with identifier '{ward_id}' not found."
        )
    return make_etag_response(ward, request, max_age=3600)


@app.get("/api/quality", response_model=QualityReport, tags=["Data Quality"])
def get_quality_report(request: Request):
    """
    Data-quality report documenting invalid geometries fixed,
    pairwise overlaps between wards, and gaps.
    """
    return make_etag_response(processor.get_quality_report(), request, max_age=3600)


# --- OSM Endpoints with Zoom LOD & LRU Caching ---

@app.get("/api/layers/{layer}", response_model=LayerFeatureCollection, tags=["OSM Layers"])
def get_layer_features(
    request: Request,
    layer: str = FastApiPath(..., description="OSM layer: boundary, roads, buildings, or parks"),
    bbox: Optional[str] = Query(None, description="Bounding box as 'minx,miny,maxx,maxy' in EPSG:4326 (WGS84 lon,lat)"),
    limit: int = Query(8000, ge=1, le=50000, description="Max feature limit to return (default 8,000 per viewport)"),
    zoom: Optional[float] = Query(None, description="Viewport zoom level for geometry LOD simplification"),
):
    """
    Returns features for the requested OSM layer filtered by bounding box with LRU caching and zoom LOD.
    """
    valid_layers = {"boundary", "roads", "buildings", "parks"}
    clean_layer = layer.lower().strip()
    if clean_layer not in valid_layers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid layer '{layer}'. Must be one of: {', '.join(sorted(valid_layers))}.",
        )

    # Default to entire PCMC bounds if bbox not provided
    if not bbox:
        minx, miny, maxx, maxy = 73.70, 18.55, 73.95, 18.75
    else:
        parts = [p.strip() for p in bbox.split(",")]
        if len(parts) != 4:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid bbox parameter '{bbox}'. Format must be 4 comma-separated floats: 'minx,miny,maxx,maxy'.",
            )
        try:
            minx, miny, maxx, maxy = [float(p) for p in parts]
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Malformed bbox coordinates in '{bbox}'. Values must be valid numbers.",
            )

        if minx > maxx or miny > maxy:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid bbox ranges: min values must be <= max values (got minx={minx}, maxx={maxx}, miny={miny}, maxy={maxy}).",
            )

    try:
        data = processor.get_layer_bbox(
            layer_name=clean_layer,
            minx=minx,
            miny=miny,
            maxx=maxx,
            maxy=maxy,
            limit=limit,
            zoom=zoom,
        )
        return make_etag_response(data, request, max_age=1800)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"Error querying layer {clean_layer}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal geospatial query failure.")


@app.get("/api/osm/stats", response_model=OSMStatsResponse, tags=["OSM Analytics"])
def get_osm_stats(request: Request):
    """
    Returns aggregate OpenStreetMap statistics for PCMC with Cache-Control & ETag.
    """
    return make_etag_response(processor.get_osm_stats(), request, max_age=3600)


@app.get("/api/wards/{ward_id}/osm", response_model=WardOSMResponse, tags=["OSM Analytics"])
def get_ward_osm(
    request: Request,
    ward_id: str = FastApiPath(..., description="Electoral ward identifier (e.g. '1', '64_1', or ward name)")
):
    """
    Returns precomputed OSM metrics for a specific ward.
    """
    data = processor.get_ward_osm(ward_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail=f"Ward with identifier '{ward_id}' not found."
        )
    return make_etag_response(data, request, max_age=3600)
