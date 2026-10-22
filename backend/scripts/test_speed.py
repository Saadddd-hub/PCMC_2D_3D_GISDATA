import sys
sys.path.insert(0, ".")
from app.geo import processor
processor._load_osm_layers()
for k, v in processor.osm_layers.items():
    print(k, list(v.columns))
