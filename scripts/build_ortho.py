"""Reproject the Jezero HiRISE orthomosaic onto the existing DTM grid."""
import argparse
import math
import re
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

from build_terrain import OUTPUT, PRODUCT, STRIDE


def build(dtm, ortho):
    with dtm.open('rb') as source:
        label = source.read(8192).decode('ascii', errors='replace')

    def field(name):
        return re.search(rf'^\s*{name}\s*=\s*([^\s]+)', label, re.M)[1].strip('"')

    if field('PRODUCT_ID') != PRODUCT or float(field('MAP_PROJECTION_ROTATION')) != 0:
        raise ValueError('Expected the north-up Jezero HiRISE DTM.')

    scale = float(field('MAP_SCALE'))
    radius = float(field('A_AXIS_RADIUS')) * 1000
    latitude = float(field('CENTER_LATITUDE'))
    longitude = float(field('CENTER_LONGITUDE'))
    crs = f'+proj=eqc +lat_ts={latitude} +lon_0={longitude} +R={radius} +units=m'
    # PDS offsets use one-based pixel centers. The mesh ends at its last sampled node.
    left = (1 - float(field('SAMPLE_PROJECTION_OFFSET'))) * scale
    top = (float(field('LINE_PROJECTION_OFFSET')) - 1) * scale
    width, height = [
        (math.ceil(int(field(name)) / STRIDE) - 1) * STRIDE * scale
        for name in ('LINE_SAMPLES', 'LINES')
    ]
    cols, rows = math.ceil(width / 3), math.ceil(height / 3)
    pixels = np.zeros((rows, cols), dtype=np.uint8)
    with rasterio.open(ortho) as source:
        reproject(
            rasterio.band(source, 1), pixels,
            src_nodata=source.nodata, dst_nodata=0,
            dst_transform=from_origin(left, top, width / cols, height / rows),
            dst_crs=crs, resampling=Resampling.average, num_threads=2,
        )

    valid = pixels != 0
    if not valid.any():
        raise ValueError('The orthomosaic does not cover the Jezero DTM.')
    low, high = np.percentile(pixels[valid], [1, 99])
    luminance = np.clip((pixels - low) / max(high - low, 1), 0, 1)
    gray = np.round(255 * (0.32 + 0.68 * luminance)).astype(np.uint8)
    image = np.stack((gray, gray, gray, valid.astype(np.uint8) * 255), axis=-1)
    Image.fromarray(image).save(OUTPUT.with_name('jezero-ortho.webp'), quality=88)
    print(f'{cols} x {rows}, coverage {valid.mean():.1%}, stretch {low:g}–{high:g}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dtm', type=Path)
    parser.add_argument('ortho', type=Path)
    args = parser.parse_args()
    build(args.dtm, args.ortho)
