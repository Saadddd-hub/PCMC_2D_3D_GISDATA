'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef, memo } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import { FlyToInterpolator } from '@deck.gl/core';
import { Map } from 'react-map-gl/maplibre';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  WardFeatureCollection,
  HeightMetricConfig,
  HEIGHT_METRICS,
  ZONE_COLORS,
  DEFAULT_ZONE_COLOR,
  OSMLayerId,
  OSMLayerState,
} from '@/types/ward';
import { fetchLayer } from '@/lib/api';

interface MapViewProps {
  wardData: WardFeatureCollection;
  is3D: boolean;
  selectedMetricId: string;
  selectedWardId: string | null;
  activeZoneFilter: string | null;
  onSelectWard: (wardId: string | null) => void;
  flyToCentroid: [number, number] | null;
  resetCameraTrigger: number;
  zoomInTrigger?: number;
  layerState: OSMLayerState;
  onZoomChange?: (zoom: number) => void;
}

const INITIAL_VIEW_STATE = {
  longitude: 73.805,
  latitude: 18.648,
  zoom: 11.4,
  pitch: 0,
  bearing: 0,
  maxZoom: 18,
  minZoom: 8,
};

const CARTO_POSITRON = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

function getRoadColor(highway: string): [number, number, number, number] {
  switch (highway) {
    case 'motorway':
    case 'motorway_link':
    case 'trunk':
    case 'trunk_link':
      return [234, 88, 12, 230];
    case 'primary':
    case 'primary_link':
      return [234, 179, 8, 220];
    case 'secondary':
    case 'secondary_link':
      return [245, 158, 11, 210];
    case 'tertiary':
    case 'tertiary_link':
      return [99, 102, 241, 190];
    case 'residential':
    case 'living_street':
      return [148, 163, 184, 160];
    default:
      return [203, 213, 225, 130];
  }
}

function getRoadWidth(highway: string): number {
  switch (highway) {
    case 'motorway':
    case 'trunk':
      return 3.5;
    case 'primary':
      return 2.8;
    case 'secondary':
      return 2.2;
    case 'tertiary':
      return 1.8;
    case 'residential':
    case 'living_street':
      return 1.2;
    default:
      return 0.9;
  }
}

export const MapView: React.FC<MapViewProps> = memo(({
  wardData,
  is3D,
  selectedMetricId,
  selectedWardId,
  activeZoneFilter,
  onSelectWard,
  flyToCentroid,
  resetCameraTrigger,
  zoomInTrigger,
  layerState,
  onZoomChange,
}) => {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    layerId: string;
    object?: any;
  } | null>(null);

  // Loaded OSM features in current viewport - retain previous features while fetching (no flash!)
  const [boundaryFeatures, setBoundaryFeatures] = useState<any[]>([]);
  const [roadFeatures, setRoadFeatures] = useState<any[]>([]);
  const [buildingFeatures, setBuildingFeatures] = useState<any[]>([]);
  const [parkFeatures, setParkFeatures] = useState<any[]>([]);
  const [osmLoading, setOsmLoading] = useState<boolean>(false);

  // Active metric config
  const metricConfig = useMemo(
    () => HEIGHT_METRICS.find((m) => m.id === selectedMetricId) || HEIGHT_METRICS[0],
    [selectedMetricId]
  );

  // Notify parent of zoom level changes
  useEffect(() => {
    onZoomChange?.(viewState.zoom);
  }, [viewState.zoom, onZoomChange]);

  // Handle 2D vs 3D camera transitions with smooth FlyToInterpolator
  useEffect(() => {
    setViewState((prev) => ({
      ...prev,
      pitch: is3D ? 55 : 0,
      bearing: is3D ? 20 : 0,
      transitionDuration: 900,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, [is3D]);

  // Handle fly-to ward centroid with FlyToInterpolator
  useEffect(() => {
    if (flyToCentroid) {
      setViewState((prev) => ({
        ...prev,
        longitude: flyToCentroid[0],
        latitude: flyToCentroid[1],
        zoom: Math.max(prev.zoom, 13.2),
        transitionDuration: 900,
        transitionInterpolator: new FlyToInterpolator(),
      }));
    }
  }, [flyToCentroid]);

  // Handle zoom-in action button
  useEffect(() => {
    if (zoomInTrigger && zoomInTrigger > 0) {
      setViewState((prev) => ({
        ...prev,
        zoom: Math.max(prev.zoom + 1.8, 13.5),
        transitionDuration: 800,
        transitionInterpolator: new FlyToInterpolator(),
      }));
    }
  }, [zoomInTrigger]);

  // Handle reset camera with FlyToInterpolator
  useEffect(() => {
    if (resetCameraTrigger > 0) {
      setViewState((prev) => ({
        ...prev,
        longitude: INITIAL_VIEW_STATE.longitude,
        latitude: INITIAL_VIEW_STATE.latitude,
        zoom: INITIAL_VIEW_STATE.zoom,
        pitch: is3D ? 55 : 0,
        bearing: is3D ? 20 : 0,
        transitionDuration: 900,
        transitionInterpolator: new FlyToInterpolator(),
      }));
    }
  }, [resetCameraTrigger, is3D]);

  // Viewport Bounding Box Calculation
  const viewportBbox = useMemo((): [number, number, number, number] => {
    const deltaLon = (360 / Math.pow(2, viewState.zoom)) * 0.75;
    const deltaLat = deltaLon * Math.cos((viewState.latitude * Math.PI) / 180);
    return [
      Number((viewState.longitude - deltaLon).toFixed(5)),
      Number((viewState.latitude - deltaLat).toFixed(5)),
      Number((viewState.longitude + deltaLon).toFixed(5)),
      Number((viewState.latitude + deltaLat).toFixed(5)),
    ];
  }, [viewState.longitude, viewState.latitude, viewState.zoom]);

  // Initial fetch for boundary
  useEffect(() => {
    if (layerState.boundary && boundaryFeatures.length === 0) {
      fetchLayer('boundary')
        .then((res) => setBoundaryFeatures(res.features || []))
        .catch((err) => console.warn('Boundary fetch failed:', err));
    }
  }, [layerState.boundary, boundaryFeatures.length]);

  // AbortController ref & Debounced Viewport Layer Fetcher (~250 ms)
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    fetchTimeoutRef.current = setTimeout(async () => {
      // Abort previous in-flight viewport request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const zoom = viewState.zoom;
      const tasks: Promise<any>[] = [];

      // Roads loaded at zoom >= 11 (pass zoom for LOD simplification)
      if (layerState.roads && zoom >= 11) {
        tasks.push(
          fetchLayer('roads', viewportBbox, 8000, zoom, controller.signal)
            .then((res) => {
              if (res.features) setRoadFeatures(res.features);
            })
            .catch((err) => {
              if (err.name !== 'AbortError') console.warn('Roads fetch error:', err);
            })
        );
      }

      // Buildings loaded at zoom >= 13, or prefetch while idle at zoom 12.0 - 12.9
      const shouldFetchBuildings = layerState.buildings && (zoom >= 13 || zoom >= 12.0);
      if (shouldFetchBuildings) {
        tasks.push(
          fetchLayer('buildings', viewportBbox, 8000, zoom, controller.signal)
            .then((res) => {
              if (res.features) setBuildingFeatures(res.features);
            })
            .catch((err) => {
              if (err.name !== 'AbortError') console.warn('Buildings fetch error:', err);
            })
        );
      }

      // Parks loaded if enabled
      if (layerState.parks && parkFeatures.length === 0) {
        tasks.push(
          fetchLayer('parks', viewportBbox, 1000, zoom, controller.signal)
            .then((res) => {
              if (res.features) setParkFeatures(res.features);
            })
            .catch((err) => {
              if (err.name !== 'AbortError') console.warn('Parks fetch error:', err);
            })
        );
      }

      if (tasks.length > 0) {
        setOsmLoading(true);
        try {
          await Promise.all(tasks);
        } finally {
          setOsmLoading(false);
        }
      }
    }, 250);

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, [viewportBbox, viewState.zoom, layerState.roads, layerState.buildings, layerState.parks]);

  // STABLE Deck.gl Layers definition:
  // Decoupled from hoverInfo! Uses GPU autoHighlight instead of React re-renders!
  const layers = useMemo(() => {
    const list: any[] = [];

    // 1. Electoral Ward Polygons Layer (Base)
    list.push(
      new GeoJsonLayer({
        id: 'pcmc-wards-geojson-layer',
        data: wardData.features,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 90],
        stroked: true,
        filled: true,
        extruded: is3D,
        wireframe: false,
        getElevation: (f: any) => {
          if (!is3D) return 0;
          const val = metricConfig.getValue(f.properties);
          return Math.max(val * metricConfig.elevationScale, 15);
        },
        getFillColor: (f: any) => {
          const zoneKey = f.properties.zone;
          const wardId = String(f.properties.wardnum);
          const isSelected = selectedWardId === wardId;
          const isFilteredOut = activeZoneFilter && activeZoneFilter !== zoneKey;

          const baseRgb = ZONE_COLORS[zoneKey]?.rgb || DEFAULT_ZONE_COLOR.rgb;

          if (isFilteredOut) {
            return [...baseRgb, 25];
          }
          if (isSelected) {
            return [255, 255, 255, 230];
          }
          return [baseRgb[0], baseRgb[1], baseRgb[2], is3D ? 190 : 150];
        },
        getLineColor: (f: any) => {
          const wardId = String(f.properties.wardnum);
          const isSelected = selectedWardId === wardId;
          if (isSelected) {
            return [244, 63, 94, 255];
          }
          return [255, 255, 255, 175];
        },
        getLineWidth: (f: any) => {
          const wardId = String(f.properties.wardnum);
          const isSelected = selectedWardId === wardId;
          return isSelected ? 3.5 : 1.2;
        },
        lineWidthUnits: 'pixels',
        updateTriggers: {
          getElevation: [is3D, selectedMetricId],
          getFillColor: [selectedWardId, activeZoneFilter, is3D],
          getLineColor: [selectedWardId],
          getLineWidth: [selectedWardId],
        },
      })
    );

    // 2. PCMC Municipal Outer Boundary (Thick outline)
    if (layerState.boundary && boundaryFeatures.length > 0) {
      list.push(
        new GeoJsonLayer({
          id: 'pcmc-osm-boundary-layer',
          data: boundaryFeatures,
          pickable: false,
          stroked: true,
          filled: false,
          getLineColor: [15, 23, 42, 240],
          getLineWidth: 3.5,
          lineWidthUnits: 'pixels',
        })
      );
    }

    // 3. Parks & Green Spaces Layer (Green fill)
    if (layerState.parks && parkFeatures.length > 0) {
      list.push(
        new GeoJsonLayer({
          id: 'pcmc-osm-parks-layer',
          data: parkFeatures,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 75],
          stroked: true,
          filled: true,
          extruded: false,
          getFillColor: [34, 197, 94, 140],
          getLineColor: [22, 163, 74, 220],
          getLineWidth: 1.5,
          lineWidthUnits: 'pixels',
        })
      );
    }

    // 4. Roads Network Layer (Styled by highway class, visible z >= 11)
    if (layerState.roads && roadFeatures.length > 0) {
      list.push(
        new GeoJsonLayer({
          id: 'pcmc-osm-roads-layer',
          data: roadFeatures,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 120],
          stroked: true,
          filled: false,
          minZoom: 11,
          getLineColor: (f: any) => getRoadColor(f.properties?.highway || 'other'),
          getLineWidth: (f: any) => getRoadWidth(f.properties?.highway || 'other'),
          lineWidthUnits: 'pixels',
        })
      );
    }

    // 5. Buildings Layer (Extruded only at zoom >= 14, material: false for 60 FPS)
    if (layerState.buildings && buildingFeatures.length > 0) {
      const isExtruded = is3D && viewState.zoom >= 14;
      list.push(
        new GeoJsonLayer({
          id: 'pcmc-osm-buildings-layer',
          data: buildingFeatures,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 100],
          stroked: true,
          filled: true,
          extruded: isExtruded,
          material: false,
          wireframe: false,
          minZoom: 13,
          getElevation: (f: any) => {
            if (!isExtruded) return 0;
            return Number(f.properties?.height_m) || 6.0;
          },
          getFillColor: [148, 163, 184, is3D ? 215 : 170],
          getLineColor: [100, 116, 139, 230],
          getLineWidth: 0.8,
          lineWidthUnits: 'pixels',
          updateTriggers: {
            getElevation: [isExtruded],
            getFillColor: [is3D],
          },
        })
      );
    }

    return list;
  }, [
    wardData.features,
    is3D,
    selectedMetricId,
    metricConfig,
    selectedWardId,
    activeZoneFilter,
    layerState,
    boundaryFeatures,
    parkFeatures,
    roadFeatures,
    buildingFeatures,
    viewState.zoom >= 14, // only recompute building extrusion boundary
  ]);

  // Throttled Hover Handler using requestAnimationFrame
  const hoverRafRef = useRef<number | null>(null);
  const handleHover = useCallback((info: any) => {
    if (hoverRafRef.current) {
      cancelAnimationFrame(hoverRafRef.current);
    }
    hoverRafRef.current = requestAnimationFrame(() => {
      if (info.object) {
        setHoverInfo({
          x: info.x,
          y: info.y,
          layerId: info.layer?.id || '',
          object: info.object,
        });
      } else {
        setHoverInfo(null);
      }
    });
  }, []);

  const handleClick = useCallback(
    (info: any) => {
      if (info.object && info.layer?.id === 'pcmc-wards-geojson-layer') {
        const clickedId = String(info.object.properties.wardnum);
        onSelectWard(selectedWardId === clickedId ? null : clickedId);
      } else if (!info.object) {
        onSelectWard(null);
      }
    },
    [onSelectWard, selectedWardId]
  );

  return (
    <div className="map-view-wrapper" id="deckgl-map-container">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: newViewState }: any) => setViewState(newViewState)}
        controller={{ doubleClickZoom: false, touchRotate: true }}
        layers={layers}
        onHover={handleHover}
        onClick={handleClick}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'default')}
      >
        <Map
          reuseMaps
          mapLib={maplibregl as any}
          mapStyle={CARTO_POSITRON}
          attributionControl={false}
        />
      </DeckGL>

      {/* OSM Loading Indicator */}
      {osmLoading && (
        <div className="osm-loading-indicator glass-panel animate-fade-in">
          <div className="spinner-tiny" />
          <span>Loading OSM viewport features...</span>
        </div>
      )}

      {/* Dynamic Hover Tooltip */}
      {hoverInfo && hoverInfo.object && (
        <div
          className="map-hover-tooltip glass-panel animate-fade-in"
          style={{
            position: 'absolute',
            left: `${hoverInfo.x + 14}px`,
            top: `${hoverInfo.y + 14}px`,
            pointerEvents: 'none',
            zIndex: 999,
          }}
        >
          {/* Ward Feature Tooltip */}
          {hoverInfo.layerId === 'pcmc-wards-geojson-layer' && (
            <>
              <div className="tooltip-header-row">
                <span
                  className="tooltip-zone-badge"
                  style={{
                    backgroundColor:
                      ZONE_COLORS[hoverInfo.object.properties.zone]?.hex || '#3b82f6',
                  }}
                >
                  Zone {hoverInfo.object.properties.zone}
                </span>
                <span className="tooltip-ward-num">
                  #{hoverInfo.object.properties.wardnum}
                </span>
              </div>
              <p className="tooltip-ward-name">{hoverInfo.object.properties.name}</p>
              <div className="tooltip-metrics-list">
                <div className="tooltip-metric-line">
                  <span className="label">Area:</span>
                  <span className="val">{hoverInfo.object.properties.area_km2.toFixed(2)} km²</span>
                </div>
                {is3D && selectedMetricId !== 'area_km2' && (
                  <div className="tooltip-metric-line highlight">
                    <span className="label">{metricConfig.label}:</span>
                    <span className="val">
                      {metricConfig.format(metricConfig.getValue(hoverInfo.object.properties))}
                    </span>
                  </div>
                )}
                {hoverInfo.object.properties.building_count > 0 && (
                  <div className="tooltip-metric-line">
                    <span className="label">Buildings:</span>
                    <span className="val">
                      {hoverInfo.object.properties.building_count.toLocaleString()}
                    </span>
                  </div>
                )}
                {hoverInfo.object.properties.road_km > 0 && (
                  <div className="tooltip-metric-line">
                    <span className="label">Roads:</span>
                    <span className="val">
                      {hoverInfo.object.properties.road_km.toFixed(1)} km
                    </span>
                  </div>
                )}
                <div className="tooltip-metric-line">
                  <span className="label">Compactness:</span>
                  <span className="val">{hoverInfo.object.properties.compactness.toFixed(3)}</span>
                </div>
              </div>
            </>
          )}

          {/* Road Feature Tooltip */}
          {hoverInfo.layerId === 'pcmc-osm-roads-layer' && (
            <>
              <div className="tooltip-header-row">
                <span className="tooltip-zone-badge" style={{ backgroundColor: '#0284c7' }}>
                  Road
                </span>
                <span className="tooltip-ward-num">
                  {hoverInfo.object.properties?.highway || 'street'}
                </span>
              </div>
              <p className="tooltip-ward-name">
                {hoverInfo.object.properties?.name || 'Unnamed Road'}
              </p>
              <div className="tooltip-metrics-list">
                {hoverInfo.object.properties?.length_km && (
                  <div className="tooltip-metric-line">
                    <span className="label">Length:</span>
                    <span className="val">
                      {(hoverInfo.object.properties.length_km * 1000).toFixed(0)} m
                    </span>
                  </div>
                )}
                {hoverInfo.object.properties?.lanes && (
                  <div className="tooltip-metric-line">
                    <span className="label">Lanes:</span>
                    <span className="val">{hoverInfo.object.properties.lanes}</span>
                  </div>
                )}
                {hoverInfo.object.properties?.surface && (
                  <div className="tooltip-metric-line">
                    <span className="label">Surface:</span>
                    <span className="val">{hoverInfo.object.properties.surface}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Building Feature Tooltip */}
          {hoverInfo.layerId === 'pcmc-osm-buildings-layer' && (
            <>
              <div className="tooltip-header-row">
                <span className="tooltip-zone-badge" style={{ backgroundColor: '#64748b' }}>
                  Building
                </span>
                <span className="tooltip-ward-num">
                  {hoverInfo.object.properties?.height_m?.toFixed(1)}m
                </span>
              </div>
              <p className="tooltip-ward-name">
                {hoverInfo.object.properties?.name ||
                  hoverInfo.object.properties?.amenity ||
                  (hoverInfo.object.properties?.building && hoverInfo.object.properties.building !== 'yes'
                    ? hoverInfo.object.properties.building
                    : 'Building Footprint')}
              </p>
              <div className="tooltip-metrics-list">
                <div className="tooltip-metric-line">
                  <span className="label">Height:</span>
                  <span className="val">{hoverInfo.object.properties?.height_m?.toFixed(1)} m</span>
                </div>
                {hoverInfo.object.properties?.levels && (
                  <div className="tooltip-metric-line">
                    <span className="label">Levels:</span>
                    <span className="val">{hoverInfo.object.properties.levels} floors</span>
                  </div>
                )}
                {hoverInfo.object.properties?.area_m2 && (
                  <div className="tooltip-metric-line">
                    <span className="label">Footprint:</span>
                    <span className="val">
                      {Math.round(hoverInfo.object.properties.area_m2).toLocaleString()} m²
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Park Feature Tooltip */}
          {hoverInfo.layerId === 'pcmc-osm-parks-layer' && (
            <>
              <div className="tooltip-header-row">
                <span className="tooltip-zone-badge" style={{ backgroundColor: '#10b981' }}>
                  Park / Green Space
                </span>
              </div>
              <p className="tooltip-ward-name">
                {hoverInfo.object.properties?.name || 'Public Park / Garden'}
              </p>
              <div className="tooltip-metrics-list">
                {hoverInfo.object.properties?.area_ha && (
                  <div className="tooltip-metric-line">
                    <span className="label">Area:</span>
                    <span className="val">
                      {hoverInfo.object.properties.area_ha.toFixed(2)} ha (
                      {(hoverInfo.object.properties.area_ha / 100).toFixed(3)} km²)
                    </span>
                  </div>
                )}
                {hoverInfo.object.properties?.leisure && (
                  <div className="tooltip-metric-line">
                    <span className="label">Type:</span>
                    <span className="val">{hoverInfo.object.properties.leisure}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});

MapView.displayName = 'MapView';
export default MapView;
