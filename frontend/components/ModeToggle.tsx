import React, { memo } from 'react';
import { HEIGHT_METRICS, HeightMetricConfig, OSMLayerId, OSMLayerState } from '@/types/ward';
import {
  Box,
  Layers,
  RotateCcw,
  Sparkles,
  Route,
  Building2,
  Trees,
  Shield,
  Info,
  Check,
  ZoomIn,
} from 'lucide-react';

interface ModeToggleProps {
  is3D: boolean;
  onToggleMode: (is3D: boolean) => void;
  selectedMetricId: string;
  onChangeMetric: (metricId: string) => void;
  onResetCamera: () => void;
  layerState: OSMLayerState;
  onToggleLayer: (layerId: OSMLayerId) => void;
  currentZoom: number;
  onZoomIn?: () => void;
}

export const ModeToggle: React.FC<ModeToggleProps> = memo(({
  is3D,
  onToggleMode,
  selectedMetricId,
  onChangeMetric,
  onResetCamera,
  layerState,
  onToggleLayer,
  currentZoom,
  onZoomIn,
}) => {
  const currentMetric = HEIGHT_METRICS.find((m) => m.id === selectedMetricId) || HEIGHT_METRICS[0];

  return (
    <div className="mode-toggle-card glass-panel" id="mode-toggle-container">
      {/* 2D / 3D View Toggle */}
      <div className="mode-pill-group">
        <button
          type="button"
          id="btn-mode-2d"
          className={`mode-btn ${!is3D ? 'active' : ''}`}
          onClick={() => onToggleMode(false)}
          title="Switch to 2D Planar View (Pitch 0°)"
        >
          <Layers className="icon-sm" />
          <span>2D Map</span>
        </button>

        <button
          type="button"
          id="btn-mode-3d"
          className={`mode-btn ${is3D ? 'active' : ''}`}
          onClick={() => onToggleMode(true)}
          title="Switch to 3D Extruded View (Pitch 55°)"
        >
          <Box className="icon-sm" />
          <span>3D Extruded</span>
        </button>
      </div>

      {/* 3D Extrusion Metric Selector */}
      {is3D && (
        <div className="metric-selector-wrapper animate-fade-in" id="height-by-selector">
          <div className="metric-header">
            <span className="metric-label-title">
              <Sparkles className="icon-xs" /> Height By
            </span>
            <span className="metric-unit-badge">{currentMetric.unit}</span>
          </div>

          <div className="select-container">
            <select
              id="height-metric-select"
              value={selectedMetricId}
              onChange={(e) => onChangeMetric(e.target.value)}
              className="metric-dropdown"
              aria-label="Select metric to extrude ward polygons by"
            >
              {HEIGHT_METRICS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.unit})
                </option>
              ))}
            </select>
          </div>

          <div className="metric-hint" title={currentMetric.description}>
            {currentMetric.description}
          </div>
        </div>
      )}

      {/* OSM Layer Toggles */}
      <div className="layer-toggles-section" id="osm-layer-toggles">
        <div className="layer-section-title">
          <Layers className="icon-xs" />
          <span>OSM Map Layers</span>
        </div>

        <div className="layer-toggle-list">
          {/* Boundary */}
          <button
            type="button"
            className={`layer-chip ${layerState.boundary ? 'active' : ''}`}
            onClick={() => onToggleLayer('boundary')}
            id="toggle-layer-boundary"
            title="Toggle PCMC Municipal Outer Boundary"
          >
            <Shield className="icon-xs" />
            <span>Boundary</span>
            {layerState.boundary && <Check className="icon-xs chip-check" />}
          </button>

          {/* Roads */}
          <button
            type="button"
            className={`layer-chip ${layerState.roads ? 'active' : ''}`}
            onClick={() => onToggleLayer('roads')}
            id="toggle-layer-roads"
            title="Toggle PCMC Street Network (Zoom ≥ 11)"
          >
            <Route className="icon-xs" />
            <span>Roads</span>
            {layerState.roads && <Check className="icon-xs chip-check" />}
          </button>

          {/* Buildings */}
          <button
            type="button"
            className={`layer-chip ${layerState.buildings ? 'active' : ''}`}
            onClick={() => onToggleLayer('buildings')}
            id="toggle-layer-buildings"
            title="Toggle Building Footprints & 3D Extrusion (Zoom ≥ 13)"
          >
            <Building2 className="icon-xs" />
            <span>Buildings</span>
            {layerState.buildings && <Check className="icon-xs chip-check" />}
          </button>

          {/* Parks */}
          <button
            type="button"
            className={`layer-chip ${layerState.parks ? 'active' : ''}`}
            onClick={() => onToggleLayer('parks')}
            id="toggle-layer-parks"
            title="Toggle Parks & Public Green Spaces"
          >
            <Trees className="icon-xs" />
            <span>Parks</span>
            {layerState.parks && <Check className="icon-xs chip-check" />}
          </button>
        </div>

        {/* Viewport Zoom Hints */}
        {layerState.buildings && currentZoom < 13 && (
          <div className="zoom-hint-banner animate-fade-in">
            <div className="zoom-hint-text">
              <Info className="icon-xs text-amber" />
              <span>Zoom in (≥ 13) to see buildings (z{currentZoom.toFixed(1)})</span>
            </div>
            {onZoomIn && (
              <button
                type="button"
                className="btn-zoom-in-hint"
                onClick={onZoomIn}
                title="Zoom into buildings view"
              >
                <ZoomIn className="icon-xs" />
                <span>Zoom In</span>
              </button>
            )}
          </div>
        )}
        {layerState.roads && currentZoom < 11 && (
          <div className="zoom-hint-banner animate-fade-in">
            <div className="zoom-hint-text">
              <Info className="icon-xs text-sky" />
              <span>Zoom in (≥ 11) to see road network (z{currentZoom.toFixed(1)})</span>
            </div>
            {onZoomIn && (
              <button
                type="button"
                className="btn-zoom-in-hint"
                onClick={onZoomIn}
                title="Zoom into roads view"
              >
                <ZoomIn className="icon-xs" />
                <span>Zoom In</span>
              </button>
            )}
          </div>
        )}

        {/* Data Quality Note */}
        <div className="data-quality-hint">
          <Info className="icon-xs text-muted" />
          <span>OSM building heights are mostly estimated (levels × 3.2m or 6m default).</span>
        </div>
      </div>

      {/* Recenter Button */}
      <button
        type="button"
        id="btn-reset-camera"
        className="reset-cam-btn"
        onClick={onResetCamera}
        title="Reset camera viewpoint to PCMC center"
      >
        <RotateCcw className="icon-xs" />
        <span>Recenter PCMC</span>
      </button>
    </div>
  );
});

ModeToggle.displayName = 'ModeToggle';
