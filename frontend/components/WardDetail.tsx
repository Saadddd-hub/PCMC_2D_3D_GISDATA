import React, { useEffect, useState, memo } from 'react';
import { WardFeature, ZONE_COLORS, DEFAULT_ZONE_COLOR } from '@/types/ward';
import { fetchWardById } from '@/lib/api';
import {
  X,
  MapPin,
  Maximize2,
  Compass,
  Activity,
  Layers,
  Copy,
  Check,
  LocateFixed,
  Building2,
  Route,
  Trees,
  TrendingUp,
} from 'lucide-react';

interface WardDetailProps {
  wardId: string | null;
  onClose: () => void;
  onFocusWard?: (centroid: [number, number]) => void;
  cityMeanArea?: number;
}

export const WardDetail: React.FC<WardDetailProps> = memo(({
  wardId,
  onClose,
  onFocusWard,
  cityMeanArea,
}) => {
  const [feature, setFeature] = useState<WardFeature | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!wardId) {
      setFeature(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    fetchWardById(wardId)
      .then((data) => {
        if (isMounted) {
          setFeature(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || 'Failed to load ward metrics');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [wardId]);

  if (!wardId) return null;

  const props = feature?.properties;
  const zoneColor = props ? (ZONE_COLORS[props.zone] || DEFAULT_ZONE_COLOR) : DEFAULT_ZONE_COLOR;

  // Comparison to average ward area
  const areaDeltaPct =
    props && cityMeanArea && cityMeanArea > 0
      ? (((props.area_km2 - cityMeanArea) / cityMeanArea) * 100).toFixed(1)
      : null;

  const handleCopy = () => {
    if (!props) return;
    const text = `Ward: ${props.name}\nZone: ${props.zone}\nArea: ${props.area_km2} km²\nPerimeter: ${props.perimeter_km} km\nCompactness: ${props.compactness}\nBuildings: ${props.building_count || 0}\nRoads: ${props.road_km || 0} km\nGreen: ${props.green_km2 || 0} km²\nCentroid: [${props.centroid_lon}, ${props.centroid_lat}]`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <aside className="ward-detail-panel glass-panel animate-slide-left" id="ward-detail-drawer">
      <div className="panel-header">
        <div className="panel-title-wrap">
          <div className="panel-badge-row">
            <span
              className="zone-tag"
              style={{
                backgroundColor: `${zoneColor.hex}22`,
                color: zoneColor.hex,
                borderColor: `${zoneColor.hex}55`,
              }}
            >
              Zone {props?.zone || '...'}
            </span>
            <span className="ward-id-pill">Ward #{props?.wardnum || wardId}</span>
          </div>
          <h2 className="ward-headline">{props?.name || `Ward ${wardId}`}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn-icon-close"
          aria-label="Close Ward Detail Panel"
        >
          <X className="icon-sm" />
        </button>
      </div>

      <div className="panel-body">
        {loading && (
          <div className="panel-state-center">
            <div className="spinner" />
            <p className="loading-text">Fetching GIS metrics from API...</p>
          </div>
        )}

        {error && (
          <div className="panel-error-box">
            <p className="error-title">Error Loading Ward</p>
            <p className="error-msg">{error}</p>
          </div>
        )}

        {!loading && props && (
          <div className="ward-metrics-grid">
            {/* Primary KPI Card: Area */}
            <div className="metric-box primary">
              <div className="metric-box-header">
                <Maximize2 className="icon-xs text-primary" />
                <span className="metric-box-label">Area (EPSG:32643)</span>
              </div>
              <div className="metric-box-val-row">
                <span className="metric-huge">{props.area_km2.toFixed(3)}</span>
                <span className="metric-unit">km²</span>
              </div>
              {areaDeltaPct !== null && (
                <div className="metric-box-sub">
                  <span
                    className={`delta-badge ${parseFloat(areaDeltaPct) >= 0 ? 'above' : 'below'}`}
                  >
                    {parseFloat(areaDeltaPct) >= 0 ? `+${areaDeltaPct}%` : `${areaDeltaPct}%`}
                  </span>
                  <span> vs. city average ({cityMeanArea?.toFixed(2)} km²)</span>
                </div>
              )}
            </div>

            {/* Perimeter */}
            <div className="metric-box">
              <div className="metric-box-header">
                <Activity className="icon-xs" />
                <span className="metric-box-label">Perimeter Distance</span>
              </div>
              <div className="metric-box-val-row">
                <span className="metric-big">{props.perimeter_km.toFixed(2)}</span>
                <span className="metric-unit">km</span>
              </div>
              <p className="metric-helper">Total boundary length in UTM 43N</p>
            </div>

            {/* Compactness */}
            <div className="metric-box">
              <div className="metric-box-header">
                <Compass className="icon-xs" />
                <span className="metric-box-label">Compactness Score</span>
              </div>
              <div className="metric-box-val-row">
                <span className="metric-big">{props.compactness.toFixed(3)}</span>
                <span className="metric-unit">/ 1.0</span>
              </div>
              <p className="metric-helper">Polsby-Popper ratio (4πA / P²)</p>
            </div>

            {/* Section: OSM Built & Infrastructure */}
            <div className="detail-section-divider full-width">
              <span className="section-divider-label">
                <Layers className="icon-xs" /> OpenStreetMap Infrastructure
              </span>
            </div>

            {/* Buildings */}
            <div className="metric-box">
              <div className="metric-box-header">
                <Building2 className="icon-xs text-amber" />
                <span className="metric-box-label">Building Count</span>
              </div>
              <div className="metric-box-val-row">
                <span className="metric-big">{(props.building_count || 0).toLocaleString()}</span>
                <span className="metric-unit">bldgs</span>
              </div>
              <p className="metric-helper">
                {props.building_density ? `${props.building_density.toFixed(1)} / km²` : '0 / km²'} density
              </p>
            </div>

            {/* Road Length */}
            <div className="metric-box">
              <div className="metric-box-header">
                <Route className="icon-xs text-sky" />
                <span className="metric-box-label">Road Network</span>
              </div>
              <div className="metric-box-val-row">
                <span className="metric-big">{(props.road_km || 0).toFixed(2)}</span>
                <span className="metric-unit">km</span>
              </div>
              <p className="metric-helper">Total roads clipped to ward</p>
            </div>

            {/* Built Area */}
            <div className="metric-box">
              <div className="metric-box-header">
                <TrendingUp className="icon-xs text-violet" />
                <span className="metric-box-label">Built Footprint</span>
              </div>
              <div className="metric-box-val-row">
                <span className="metric-big">{(props.built_area_km2 || 0).toFixed(3)}</span>
                <span className="metric-unit">km²</span>
              </div>
              <p className="metric-helper">
                {props.area_km2 > 0
                  ? `${(((props.built_area_km2 || 0) / props.area_km2) * 100).toFixed(1)}% of ward`
                  : '0%'}
              </p>
            </div>

            {/* Green Space */}
            <div className="metric-box">
              <div className="metric-box-header">
                <Trees className="icon-xs text-emerald" />
                <span className="metric-box-label">Green Space</span>
              </div>
              <div className="metric-box-val-row">
                <span className="metric-big">{(props.green_km2 || 0).toFixed(3)}</span>
                <span className="metric-unit">km²</span>
              </div>
              <p className="metric-helper">Parks & open recreation</p>
            </div>

            {/* Centroid coordinates */}
            <div className="metric-box full-width">
              <div className="metric-box-header">
                <MapPin className="icon-xs" />
                <span className="metric-box-label">Calculated Centroid (WGS84)</span>
              </div>
              <div className="centroid-coords-display">
                <code>
                  {props.centroid_lat.toFixed(6)}° N, {props.centroid_lon.toFixed(6)}° E
                </code>
              </div>
            </div>

            {/* Action Bar */}
            <div className="ward-actions-bar">
              {onFocusWard && (
                <button
                  type="button"
                  className="btn-action primary"
                  onClick={() => onFocusWard([props.centroid_lon, props.centroid_lat])}
                >
                  <LocateFixed className="icon-xs" />
                  <span>Zoom To Ward</span>
                </button>
              )}

              <button
                type="button"
                className="btn-action secondary"
                onClick={handleCopy}
              >
                {copied ? <Check className="icon-xs text-green" /> : <Copy className="icon-xs" />}
                <span>{copied ? 'Copied' : 'Copy Metrics'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
});

WardDetail.displayName = 'WardDetail';
