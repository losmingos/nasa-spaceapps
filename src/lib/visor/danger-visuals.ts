import {
	CircleGeometry, Color, DoubleSide, InstancedMesh, MathUtils, MeshBasicMaterial, Object3D,
	RingGeometry, type Scene
} from 'three';
import { DANGER_TUNING } from './danger.js';
import type { RockContact } from './rock-contact.js';

const MAX_RINGS = 1024;
const LIGHT_COLOR = '#f5c542';
const STRONG_COLOR = '#ff8a2a';

export function createDangerRings(scene: Scene, heightAt: (x: number, z: number) => number) {
	const discGeometry = new CircleGeometry(1, 24);
	discGeometry.rotateX(-Math.PI / 2);
	const ringGeometry = new RingGeometry(0.82, 1, 32);
	ringGeometry.rotateX(-Math.PI / 2);
	const discMaterial = new MeshBasicMaterial({
		color: '#ffffff', transparent: true, opacity: 0.36, depthWrite: false, side: DoubleSide
	});
	const ringMaterial = new MeshBasicMaterial({
		color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide
	});
	const discs = new InstancedMesh(discGeometry, discMaterial, MAX_RINGS);
	const rings = new InstancedMesh(ringGeometry, ringMaterial, MAX_RINGS);
	for (const mesh of [discs, rings]) {
		mesh.visible = false;
		mesh.frustumCulled = false;
		scene.add(mesh);
	}

	const dummy = new Object3D();
	const color = new Color();
	let count = 0;

	function setRocks(rocks: readonly RockContact[], visible: boolean) {
		count = 0;
		for (const rock of rocks) {
			if (rock.scale < DANGER_TUNING.rockHazardMinM) continue;
			if (count >= MAX_RINGS) break;
			const { min, max } = rock.bounds;
			const cx = (min.x + max.x) / 2;
			const cz = (min.z + max.z) / 2;
			const rockRadius = Math.max(max.x - min.x, max.z - min.z) / 2;
			if (!(rockRadius > 0)) continue;
			const strong = rock.scale > DANGER_TUNING.rockRingStrongM;
			const factor = MathUtils.clamp(rockRadius / DANGER_TUNING.rockRingReferenceM, 0.35, 1);
			const margin = DANGER_TUNING.rockProximityM * DANGER_TUNING.rockHazardScale * factor * (strong ? 1.2 : 1);
			const zone = rockRadius + margin;
			const y = heightAt(cx, cz);
			color.set(strong ? STRONG_COLOR : LIGHT_COLOR);
			dummy.position.set(cx, y + 0.06, cz);
			dummy.scale.setScalar(zone);
			dummy.updateMatrix();
			discs.setMatrixAt(count, dummy.matrix);
			discs.setColorAt(count, color);
			dummy.position.y = y + 0.07;
			dummy.updateMatrix();
			rings.setMatrixAt(count, dummy.matrix);
			rings.setColorAt(count, color);
			count++;
		}
		discs.count = count;
		rings.count = count;
		discs.instanceMatrix.needsUpdate = true;
		rings.instanceMatrix.needsUpdate = true;
		if (discs.instanceColor) discs.instanceColor.needsUpdate = true;
		if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
		const show = visible && count > 0;
		discs.visible = show;
		rings.visible = show;
	}

	function setVisible(visible: boolean) {
		const show = visible && count > 0;
		discs.visible = show;
		rings.visible = show;
	}

	function dispose() {
		for (const mesh of [discs, rings]) scene.remove(mesh);
		discGeometry.dispose();
		ringGeometry.dispose();
		discMaterial.dispose();
		ringMaterial.dispose();
	}

	return { setRocks, setVisible, dispose };
}
