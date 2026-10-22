# PCMC 2D/3D Electoral Ward GIS Visualizer

A full-stack monorepo web application that visualizes Pimpri-Chinchwad Municipal Corporation (PCMC) electoral ward boundaries in both **2D planar** and **3D extruded** perspectives. Built with a high-performance **FastAPI (Python)** geospatial backend and a modern **Next.js (TypeScript, deck.gl, MapLibre)** frontend.

---

## 🏛️ Project Architecture

```
PCMC_2D_3D_GISDATA/
├── pcmc-electoral-wards.geojson      # Original input dataset (EPSG:4326, 66 wards, untouched)
├── Makefile                          # Development and testing tasks
├── package.json                      # Monorepo scripts
├── .gitignore                        # Python venv, caches, node_modules, Next.js build
│
├── backend/                          # FastAPI Geospatial Microservice
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                   # FastAPI app, CORS, Lifespan handler, endpoints
│   │   ├── geo.py                    # GeoPandas processing, UTM 43N projection, metrics & quality audit
│   │   └── schemas.py                # Pydantic v2 schemas for GeoJSON and responses
│   ├── data/                         # Derived output cache (pcmc-wards-processed.geojson, stats, quality)
│   ├── tests/
│   │   ├── __init__.py
│   │   └── test_api.py               # Pytest suite (66 wards, positive area, ~177 km², health, lookups)
│   └── requirements.txt              # FastAPI, GeoPandas, Shapely, PyProj, Uvicorn, Pytest, HTTPX
│
└── frontend/                         # Next.js 16 (App Router) + deck.gl + MapLibre
    ├── app/
    │   ├── layout.tsx                # Inter typography and SEO metadata
    │   ├── page.tsx                  # Interactive map stage, search, drawers, modals
    │   └── globals.css               # Vanilla CSS design system (dark glassmorphism, responsive)
    ├── components/
    │   ├── MapView.tsx               # Deck.GL GeoJsonLayer + MapLibre CARTO Positron
    │   ├── ModeToggle.tsx            # 2D/3D pill switch & "Height by" metric selector
    │   ├── Legend.tsx                # Zone palette (A-F) with counts and interactive filters
    │   ├── StatsPanel.tsx            # City aggregates, Recharts bar chart, and zone table
    │   ├── WardDetail.tsx            # Sliding drawer with metrics fetched from /api/wards/{id}
    │   └── QualityModal.tsx          # Topological audit report (/api/quality)
    ├── lib/
    │   └── api.ts                    # Typed API client
    ├── types/
    │   └── ward.ts                   # Shared TypeScript models and extensible HEIGHT_METRICS config
    └── package.json
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Python 3.10+** (Python 3.11+ recommended)
- **Node.js 18+** & npm

---

### 2. Backend Setup & Run (FastAPI)

1. Open a terminal in `backend/`:
   ```bash
   cd backend
   python -m venv .venv

   # Activate virtual environment:
   # On Windows (PowerShell):
   .\.venv\Scripts\Activate.ps1
   # On macOS/Linux:
   source .venv/bin/activate

   # Install dependencies:
   pip install -r requirements.txt
   ```

2. Start the FastAPI development server:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   The backend API will be live at `http://localhost:8000`. Interactive Swagger API docs are available at `http://localhost:8000/docs`.

---

### 3. Frontend Setup & Run (Next.js)

1. Open a second terminal in `frontend/`:
   ```bash
   cd frontend
   npm install
   ```

2. Start the Next.js development server:
   ```bash
   npm run dev
   ```
   Open your browser at [http://localhost:3000](http://localhost:3000).

---

## 🧪 Testing & Verification

### Run Backend Pytest Suite
From repo root (with backend venv active):
```bash
pytest backend/tests -v
```
**Tests verify:**
- Server health (`/api/health`)
- Exactly 66 wards loaded and all areas/perimeters positive
- Total area is ~177 km² within 5% tolerance (`176.77 km²`)
- Per-zone breakdown across Zones A through F with 100% share sum
- Single ward lookup by integer or string ID (e.g. `1`, `64_1`) with 404 for missing wards
- Topological quality check reporting overlaps and union vs sum gaps

### Run Frontend Production Build
```bash
cd frontend
npm run build
```

---

## 📡 Backend API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status and count of loaded wards (`66`) |
| `GET` | `/api/wards` | GeoJSON FeatureCollection with EPSG:4326 coordinates rounded to 6 decimals, plus computed `area_km2`, `perimeter_km`, `compactness`, and `centroid_lon`/`centroid_lat` |
| `GET` | `/api/stats` | City-wide totals, per-zone breakdown (ward count, total area, mean area, share %), plus largest and smallest wards |
| `GET` | `/api/wards/{ward_id}` | Feature and full metrics for a specific ward (e.g. `1`, `64_1`, `58_2`); returns 404 if missing |
| `GET` | `/api/quality` | Spatial quality audit: invalid geometries fixed, pairwise boundary sliver overlaps, and union vs sum area gaps |

---

## 🗺️ Geospatial Calculation Details

1. **Coordinate Reference System (CRS):**
   - Electoral ward boundaries originate in **WGS84 (EPSG:4326)**.
   - For metric accuracy, geometries are reprojected into **EPSG:32643 (UTM Zone 43N)**, which precisely covers Maharashtra / PCMC.
   - Area is converted from $m^2$ to $km^2$ ($\div 10^6$), perimeter from $m$ to $km$ ($\div 10^3$).
2. **Compactness Score:**
   - Evaluated using the standard **Polsby-Popper ratio**:
     $$\text{Compactness} = \frac{4\pi \cdot \text{Area}}{\text{Perimeter}^2}$$
3. **Data Quality Audit:**
   - **Invalid Geometries:** Dropped 3D coordinates ($Z$) and applied `shapely.make_valid()`. All 66 wards are 100% topologically valid.
   - **Overlaps:** Evaluated using spatial index ($R$-tree) intersection querying; detected 123 minor boundary slivers typical of electoral polygon digitization totaling $< 0.04\text{ km}^2$.
   - **Gaps:** Dissolved union area ($176.74\text{ km}^2$) matches individual area sum ($176.77\text{ km}^2$) within $0.02\%$.
4. **Derived Data Protection:**
   - The original file `pcmc-electoral-wards.geojson` is **never modified**. Derived outputs are written to `backend/data/`.

---

## 🎨 Frontend Features

- **Client-Side Map Rendering:** Deck.GL `GeoJsonLayer` over a free CARTO Positron vector/raster basemap with no API keys required. Loaded dynamically with `ssr: false`.
- **2D / 3D Smooth Transitions:**
  - **2D Mode:** Planar view with zero pitch.
  - **3D Extruded Mode:** Pitch $\sim 55^\circ$, bearing $\sim 20^\circ$, smooth camera transition with animated polygon extrusion height.
- **Zone Palette & Interactive Legend:** Zones A through F have distinct, curated high-contrast colors. Clicking a zone isolates that zone on the map.
- **Extensible 3D Elevation Selector:**
  - Dropdown supports extrusion by `area_km2`, `perimeter_km`, and `compactness`.
  - Adding a new metric (e.g. `tree_count`, `population`) requires editing just **one configuration array** in `frontend/types/ward.ts`:
    ```ts
    export const HEIGHT_METRICS: HeightMetricConfig[] = [
      {
        id: 'tree_count',
        label: 'Tree Canopy Count',
        unit: 'trees',
        description: 'Estimated municipal street tree count',
        elevationScale: 0.5,
        getValue: (p) => p.tree_count,
        format: (v) => `${v.toLocaleString()} trees`,
      },
    ];
    ```
- **Hover Tooltip & Selected Ward Drawer:**
  - Hovering displays a glassmorphic tooltip with ward name, zone, area, and active metric.
  - Clicking selects a ward, highlights its boundary, and slides open the detailed metrics panel fetched from `/api/wards/{id}`.
- **City Analytics Panel:**
  - Summary KPI cards (total wards, total km², mean ward area).
  - Area by Zone bar chart using **Recharts**.
  - Detailed zone breakdown table.
- **Data Quality Audit Modal:** Click **Data Quality** in the header to view the full topological verification report from `/api/quality`.

---

## 📄 License
MIT License.