import * as THREE from 'three/webgpu';
import {
	Fn, uniform, float, vec3, vec4, mix, smoothstep,
	positionWorld, normalWorldGeometry, lights, mx_fractal_noise_float
} from 'three/tsl';
import { createGoboSpotLight, createProceduralEnvironment } from '../../engine/index.js';

// Studio cyclorama backdrop, gobo key spotlight, coloured particle fills,
// and procedural softbox PMREM built on top of `src/engine/Lighting.js`.

function buildCyclorama( { floorY, wallZ, coveRadius } ) {

	const halfWidth = 70;
	const front = 30;
	const top = 26;
	const arcSegments = 48;

	const rows = [ { y: floorY, z: front, ny: 1, nz: 0 } ];
	const cy = floorY + coveRadius;
	const cz = wallZ + coveRadius;

	for ( let i = 0; i <= arcSegments; i ++ ) {

		const a = ( i / arcSegments ) * Math.PI * 0.5;
		rows.push( {
			y: cy - Math.cos( a ) * coveRadius,
			z: cz - Math.sin( a ) * coveRadius,
			ny: Math.cos( a ),
			nz: Math.sin( a )
		} );

	}

	rows.push( { y: top, z: wallZ, ny: 0, nz: 1 } );

	const positions = [];
	const normals = [];
	const indices = [];

	for ( const row of rows ) {

		positions.push( - halfWidth, row.y, row.z, halfWidth, row.y, row.z );
		normals.push( 0, row.ny, row.nz, 0, row.ny, row.nz );

	}

	for ( let r = 0; r < rows.length - 1; r ++ ) {

		const a = r * 2, b = a + 1, c = a + 2, d = a + 3;
		indices.push( a, b, d, a, d, c );

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geometry.setIndex( indices );
	return geometry;

}

export function createSnowLightStudio( { scene, renderer, config, orbLight } ) {

	const { world, light: lightConfig } = config;

	const spotRig = createGoboSpotLight( {
		scene,
		...lightConfig.spot
	} );

	const fillMagenta = new THREE.DirectionalLight( lightConfig.fillMagenta.color, lightConfig.fillMagenta.intensity );
	fillMagenta.position.fromArray( lightConfig.fillMagenta.direction ).multiplyScalar( 20 );

	const fillTeal = new THREE.DirectionalLight( lightConfig.fillTeal.color, lightConfig.fillTeal.intensity );
	fillTeal.position.fromArray( lightConfig.fillTeal.direction ).multiplyScalar( 20 );

	scene.add( fillMagenta, fillTeal );

	const rig = {
		spot: spotRig.spot,
		fillMagenta,
		fillTeal,
		spotPosition: spotRig.uniforms.position,
		spotDirection: spotRig.uniforms.direction,
		spotColor: spotRig.uniforms.color,
		spotConeCos: spotRig.uniforms.coneCos,
		fillMagentaDirection: uniform( new THREE.Vector3().fromArray( lightConfig.fillMagenta.direction ).normalize() ),
		fillMagentaColor: uniform( new THREE.Color( lightConfig.fillMagenta.color ).multiplyScalar( lightConfig.fillMagenta.intensity ) ),
		fillTealDirection: uniform( new THREE.Vector3().fromArray( lightConfig.fillTeal.direction ).normalize() ),
		fillTealColor: uniform( new THREE.Color( lightConfig.fillTeal.color ).multiplyScalar( lightConfig.fillTeal.intensity ) )
	};

	const geometry = buildCyclorama( world );
	const material = new THREE.MeshStandardNodeMaterial( { metalness: 0 } );

	const floorness = smoothstep( 0.15, 0.95, normalWorldGeometry.y );
	const broad = mx_fractal_noise_float( positionWorld.mul( 0.32 ), 2, 2.3, 0.5 );

	material.colorNode = Fn( () => {

		const base = mix( vec3( 0.135, 0.135, 0.146 ), vec3( 0.15, 0.148, 0.156 ), floorness );
		return vec4( base.mul( float( 1 ).add( broad.mul( 0.16 ) ) ), 1 );

	} )();

	material.roughnessNode = mix( float( 0.8 ), float( 0.4 ), floorness )
		.add( broad.mul( 0.1 ) )
		.clamp( 0.22, 0.95 );

	material.lightsNode = lights( [ orbLight, spotRig.spot ] );

	const backdrop = new THREE.Mesh( geometry, material );
	backdrop.receiveShadow = true;
	backdrop.frustumCulled = false;
	scene.add( backdrop );

	const envTarget = createProceduralEnvironment( renderer, {
		background: 0x000000,
		sigma: 0.03,
		cards: [
			{ width: 7, height: 7, color: 0xfff1de, intensity: 10, position: [ 8, 10, 3 ] },
			{ width: 3, height: 12, color: 0xff5aa8, intensity: 2.6, position: [ - 11, 3, 3 ] },
			{ width: 12, height: 3, color: 0x45d9cf, intensity: 2.6, position: [ 7, - 9, 5 ] },
			{ width: 10, height: 2, color: 0x9db8ff, intensity: 1.6, position: [ 0, 4, 13 ] }
		]
	} );

	function dispose() {

		if ( backdrop.parent ) backdrop.parent.remove( backdrop );
		geometry.dispose();
		material.dispose();
		envTarget.dispose();

	}

	return { backdrop, rig, environment: envTarget.texture, dispose };

}
