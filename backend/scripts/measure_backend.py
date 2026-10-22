import urllib.request
import urllib.error
import time
import gzip
import json

ENDPOINTS = [
    ("GET /api/wards", "http://127.0.0.1:8000/api/wards"),
    ("GET /api/stats", "http://127.0.0.1:8000/api/stats"),
    ("GET /api/osm/stats", "http://127.0.0.1:8000/api/osm/stats"),
    ("GET /api/layers/boundary", "http://127.0.0.1:8000/api/layers/boundary"),
    ("GET /api/layers/roads (bbox)", "http://127.0.0.1:8000/api/layers/roads?bbox=73.76,18.60,73.84,18.68"),
    ("GET /api/layers/buildings (bbox)", "http://127.0.0.1:8000/api/layers/buildings?bbox=73.76,18.60,73.84,18.68"),
    ("GET /api/layers/parks (bbox)", "http://127.0.0.1:8000/api/layers/parks?bbox=73.76,18.60,73.84,18.68"),
    ("GET /api/wards/1", "http://127.0.0.1:8000/api/wards/1"),
    ("GET /api/wards/1/osm", "http://127.0.0.1:8000/api/wards/1/osm"),
]

def measure(url, accept_gzip=False):
    headers = {"User-Agent": "perf-tester"}
    if accept_gzip:
        headers["Accept-Encoding"] = "gzip"
    req = urllib.request.Request(url, headers=headers)
    t0 = time.perf_counter()
    with urllib.request.urlopen(req) as resp:
        content = resp.read()
        is_gzipped = resp.headers.get("Content-Encoding") == "gzip"
    t1 = time.perf_counter()
    
    elapsed_ms = (t1 - t0) * 1000
    
    if is_gzipped:
        decompressed = gzip.decompress(content)
        raw_size = len(decompressed)
        gzip_size = len(content)
        parsed = json.loads(decompressed.decode("utf-8"))
    else:
        raw_size = len(content)
        # compress to see what gzip would be
        gzip_size = len(gzip.compress(content))
        parsed = json.loads(content.decode("utf-8"))
        
    feature_count = None
    if isinstance(parsed, dict):
        if "features" in parsed:
            feature_count = len(parsed["features"])
        elif "total_wards" in parsed:
            feature_count = parsed["total_wards"]
        elif "total_buildings" in parsed:
            feature_count = parsed.get("total_buildings")
        elif "properties" in parsed:
            feature_count = 1
            
    return elapsed_ms, raw_size, gzip_size, feature_count

print(f"{'Endpoint':<35} | {'Cold (ms)':<10} | {'Warm (ms)':<10} | {'Raw (KB)':<10} | {'Gzip (KB)':<10} | {'Features':<8}")
print("-" * 95)

results = []
for name, url in ENDPOINTS:
    # First request: cold
    cold_ms, raw_size, gzip_size, feat_count = measure(url, accept_gzip=True)
    # Warm requests: 3 runs average
    warm_runs = []
    for _ in range(3):
        w_ms, _, _, _ = measure(url, accept_gzip=True)
        warm_runs.append(w_ms)
    warm_ms = sum(warm_runs) / len(warm_runs)
    
    raw_kb = raw_size / 1024
    gzip_kb = gzip_size / 1024
    
    feat_str = str(feat_count) if feat_count is not None else "N/A"
    print(f"{name:<35} | {cold_ms:>9.1f} | {warm_ms:>9.1f} | {raw_kb:>9.1f} | {gzip_kb:>9.1f} | {feat_str:>8}")
    results.append({
        "endpoint": name,
        "url": url,
        "cold_ms": cold_ms,
        "warm_ms": warm_ms,
        "raw_kb": raw_kb,
        "gzip_kb": gzip_kb,
        "features": feat_str
    })

with open("backend_perf.json", "w") as f:
    json.dump(results, f, indent=2)
