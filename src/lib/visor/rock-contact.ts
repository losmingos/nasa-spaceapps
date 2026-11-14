import { Box3, Mesh, Raycaster, Vector3, type BufferGeometry, type Intersection, type Matrix4 } from 'three';

const maxStepHeight = 0.34;
const footRadius = 0.20;
const diagonal = Math.SQRT1_2;
const footRadii = [footRadius * 0.5, footRadius];
const footSamples = [
	[1, 0], [diagonal, diagonal], [0, 1], [-diagonal, diagonal],
	[-1, 0], [-diagonal, -diagonal], [0, -1], [diagonal, -diagonal]
];
const probe = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
const rockMesh = new Mesh();
const hits: Intersection[] = [];

export function createRockContact(geometry: BufferGeometry, matrix: Matrix4, exposedHeight: number) {
	if (!geometry.boundingBox) geometry.computeBoundingBox();
	return {
		geometry,
		matrix: matrix.clone(),
		bounds: new Box3().copy(geometry.boundingBox!).applyMatrix4(matrix),
		stepable: exposedHeight <= maxStepHeight
	};
}

export type RockContact = ReturnType<typeof createRockContact>;

function rockTop(x: number, z: number, top: number) {
	probe.ray.origin.set(x, top + 0.01, z);
	hits.length = 0;
	rockMesh.raycast(probe, hits);
	let height = -Infinity;
	for (const hit of hits) height = Math.max(height, hit.point.y);
	return height;
}

export function footingOnRocks(rocks: readonly RockContact[], ground: number, x: number, z: number, scripted = false) {
	let height = ground;
	if (!Number.isFinite(ground)) return { height, blocked: false };
	for (const rock of rocks) {
		const { min, max } = rock.bounds;
		if (x < min.x - footRadius || x > max.x + footRadius ||
			z < min.z - footRadius || z > max.z + footRadius || max.y <= ground) continue;
		rockMesh.geometry = rock.geometry;
		rockMesh.matrixWorld.copy(rock.matrix);
		const center = rockTop(x, z, max.y);
		const stepable = rock.stepable || scripted;
		if (!stepable && center > ground) return { height, blocked: true };
		height = Math.max(height, center);
		// Sample ahead of the foot to lift it progressively before reaching a sharp edge.
		for (const radius of footRadii) {
			for (const [dx, dz] of footSamples) {
				const top = rockTop(x + dx * radius, z + dz * radius, max.y);
				if (top <= ground) continue;
				if (!stepable) return { height, blocked: true };
				height = Math.max(height, ground + (top - ground) * (1 - radius / (footRadius * 1.25)));
			}
		}
	}
	return { height, blocked: false };
}
