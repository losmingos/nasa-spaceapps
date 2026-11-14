"""Build the browser terrain from the official Jezero HiRISE PDS3 IMG."""
import argparse
import math
import re
import struct
from pathlib import Path

PRODUCT = "DTEEC_002387_1985_003798_1985_A01"
STRIDE = 16
OUTPUT = Path(__file__).resolve().parents[1] / "static/terrain/jezero.bin"


def convert(source):
    header = source.read(8192).decode("ascii", errors="replace").split("\nEND\r")[0]

    def field(name):
        match = re.search(rf"^\s*{re.escape(name)}\s*=\s*([^\s]+)", header, re.M)
        if not match:
            raise ValueError(f"Missing PDS field: {name}")
        return match[1].strip('"')

    if field("PRODUCT_ID") != PRODUCT or field("SAMPLE_TYPE") != "PC_REAL":
        raise ValueError("Expected the Jezero HiRISE product with PC_REAL samples.")
    width, height = int(field("LINE_SAMPLES")), int(field("LINES"))
    record_bytes = int(field("RECORD_BYTES"))
    start = (int(field("^IMAGE")) - 1) * record_bytes
    if record_bytes != width * 4 or int(field("SAMPLE_BITS")) != 32:
        raise ValueError("Unexpected raster layout.")
    source.seek(0, 2)
    if source.tell() != start + record_bytes * height:
        raise ValueError("Incomplete raster.")

    cols, rows = math.ceil(width / STRIDE), math.ceil(height / STRIDE)
    spacing = float(field("MAP_SCALE")) * STRIDE
    scale, offset = float(field("SCALING_FACTOR")), float(field("OFFSET"))
    missing = int(field("MISSING_CONSTANT").split("#")[1], 16)
    result = bytearray(struct.pack("<IIf", cols, rows, spacing))
    minimum, maximum = math.inf, -math.inf
    valid = 0
    for row in range(0, height, STRIDE):
        source.seek(start + row * record_bytes)
        data = source.read(record_bytes)
        for col in range(0, width, STRIDE):
            bits, = struct.unpack_from("<I", data, col * 4)
            elevation = math.nan
            if bits != missing:
                sample, = struct.unpack_from("<f", data, col * 4)
                elevation = sample * scale + offset
                minimum = min(minimum, elevation)
                maximum = max(maximum, elevation)
                valid += 1
            result.extend(struct.pack("<f", elevation))
    if not valid:
        raise ValueError("No valid elevations.")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(result)
    print(f"{cols} x {rows}, {spacing:g} m, {valid} valid points, {minimum:.2f} to {maximum:.2f} m")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("img", type=Path)
    with parser.parse_args().img.open("rb") as source:
        convert(source)
