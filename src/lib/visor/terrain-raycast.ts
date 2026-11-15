import { Box3, Vector3, type BufferAttribute, type Ray } from 'three';

// The grid is axis aligned. Walk only the cells crossed by the reticle ray and
// test the same two front-facing triangles (and missing samples) as the mesh.
export function createTerrainRaycast(positions: BufferAttribute, elevations: Float32Array,
	columns: number, rows: number, spacing: number, height: number) {
	const bounds = new Box3(
		new Vector3(positions.getX(0), 0, positions.getZ(0)),
		new Vector3(positions.getX(columns - 1), height, positions.getZ((rows - 1) * columns))
	);
	const entry = new Vector3();
	const a = new Vector3();
	const b = new Vector3();
	const c = new Vector3();
	const hit = new Vector3();

	return (ray: Ray): number | undefined => {
		if (bounds.containsPoint(ray.origin)) entry.copy(ray.origin);
		else if (!ray.intersectBox(bounds, entry)) return;

		let column = Math.min(columns - 2, Math.max(0, Math.floor((entry.x - bounds.min.x) / spacing)));
		let row = Math.min(rows - 2, Math.max(0, Math.floor((entry.z - bounds.min.z) / spacing)));
		// Use the actual Float32 vertex coordinates at cell boundaries.
		if (column > 0 && entry.x < positions.getX(column)) column--;
		else if (column < columns - 2 && entry.x > positions.getX(column + 1)) column++;
		if (row > 0 && entry.z < positions.getZ(row * columns)) row--;
		else if (row < rows - 2 && entry.z > positions.getZ((row + 1) * columns)) row++;

		const { x: dx, z: dz } = ray.direction;
		const stepX = Math.sign(dx), stepZ = Math.sign(dz);
		const boundaryX = dx > 0 ? 1 : 0;
		const boundaryZ = dz > 0 ? 1 : 0;
		while (column >= 0 && column < columns - 1 && row >= 0 && row < rows - 1) {
			const i = row * columns + column;
			const east = i + 1, south = i + columns, southeast = south + 1;
			if (Number.isFinite(elevations[east]) && Number.isFinite(elevations[south])) {
				a.fromBufferAttribute(positions, east);
				b.fromBufferAttribute(positions, south);
				let nearest = Infinity;
				if (Number.isFinite(elevations[i]) &&
					ray.intersectTriangle(c.fromBufferAttribute(positions, i), b, a, true, hit)) {
					nearest = ray.origin.distanceTo(hit);
				}
				if (Number.isFinite(elevations[southeast]) &&
					ray.intersectTriangle(a, b, c.fromBufferAttribute(positions, southeast), true, hit)) {
					nearest = Math.min(nearest, ray.origin.distanceTo(hit));
				}
				if (nearest < Infinity) return nearest;
			}
			if (!stepX && !stepZ) return;
			const nextX = stepX ? (positions.getX(column + boundaryX) - ray.origin.x) / dx : Infinity;
			const nextZ = stepZ ? (positions.getZ((row + boundaryZ) * columns) - ray.origin.z) / dz : Infinity;
			if (nextX <= nextZ) column += stepX;
			else row += stepZ;
		}
	};
}
