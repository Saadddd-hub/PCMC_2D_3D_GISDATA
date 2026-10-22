#!/usr/bin/env bash
# ==============================================================================
# PCMC Vector Tiles Generator using Tippecanoe
#
# Generates PMTiles / MVT directory for:
#   - roads: minzoom 10, maxzoom 16
#   - buildings: minzoom 13, maxzoom 17
#   - parks: minzoom 11, maxzoom 16
#   - boundary / wards: minzoom 8, maxzoom 16
#
# Install instructions if tippecanoe is not installed:
#   Ubuntu/Debian / WSL:
#     sudo apt-get install -y build-essential libsqlite3-dev zlib1g-dev
#     git clone https://github.com/felt/tippecanoe.git
#     cd tippecanoe && make -j && sudo make install
#   macOS:
#     brew install tippecanoe
#   Conda:
#     conda install -c conda-forge tippecanoe
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DATA_DIR="${ROOT_DIR}/backend/data/osm"
OUT_DIR="${ROOT_DIR}/backend/data/tiles"

mkdir -p "${OUT_DIR}"

if ! command -v tippecanoe &> /dev/null; then
    echo "ERROR: tippecanoe is not installed."
    echo "To install on Ubuntu/WSL:"
    echo "  sudo apt-get install -y build-essential libsqlite3-dev zlib1g-dev"
    echo "  git clone https://github.com/felt/tippecanoe.git"
    echo "  cd tippecanoe && make -j && sudo make install"
    echo "To install with Conda: conda install -c conda-forge tippecanoe"
    exit 1
fi

echo "==> Generating PMTiles for PCMC Roads (z10-z16)..."
if [ -f "${DATA_DIR}/roads.geojson" ]; then
    tippecanoe -o "${OUT_DIR}/roads.pmtiles" \
        -l roads \
        -Z 10 -z 16 \
        --drop-densest-as-needed \
        --extend-zooms-if-still-dropping \
        --force \
        "${DATA_DIR}/roads.geojson"
fi

echo "==> Generating PMTiles for PCMC Buildings (z13-z17)..."
if [ -f "${DATA_DIR}/buildings.geojson" ]; then
    tippecanoe -o "${OUT_DIR}/buildings.pmtiles" \
        -l buildings \
        -Z 13 -z 17 \
        --drop-densest-as-needed \
        --force \
        "${DATA_DIR}/buildings.geojson"
fi

echo "==> Generating PMTiles for PCMC Parks (z11-z16)..."
if [ -f "${DATA_DIR}/parks.geojson" ]; then
    tippecanoe -o "${OUT_DIR}/parks.pmtiles" \
        -l parks \
        -Z 11 -z 16 \
        --force \
        "${DATA_DIR}/parks.geojson"
fi

echo "==> Vector tiles generation complete in ${OUT_DIR}"
