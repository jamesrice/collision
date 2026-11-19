import * as THREE from 'three/webgpu';
import {
	createCollisionEngine,
	createCollider,
	createLightShaft
} from '../../engine/index.js';
import { SNOW_AND_LIGHT_CONFIG } from './config.js';
import { createSnowLightStudio } from './studio.js';
import { createOrbVisuals } from './orbVisuals.js';
import { createSnowSwarm } from './swarm.js';

// "Snow & Light" interactive experience built on the `src/engine` framework.

export async function createSnowAndLightExperience( { container, config = SNOW_AND_LIGHT_CONFIG } ) {

	const engine = await createCollisionEngine( {
		container,
		background: config.background,
		tiers: config.tiers,
		camera: config.camera,
		post: config.post,
		enableOverlayScene: true
	} );

	const { renderer, scene, overlayScene, camera, frame, quality, post, colliders } = engine;

	const collider = createCollider( {
		camera,
		element: container,
		mode: 'plane',
		planeNormal: new THREE.Vector3( 0, 0, 1 ),
		planeConstant: 0,
		radius: config.orb.shieldRadius,
		stiffness: config.orb.stiffness,
		damping: config.orb.damping,
		maxSpeed: config.orb.maxSpeed,
		depthSway: config.orb.depthSway,
		idleAfter: config.orb.idleAfter,
		chargeScale: config.orb.chargeScale,
		floorY: config.world.floorY
	} );
	colliders.add( collider );
	collider.setBounds( frame.halfWidth, frame.halfHeight, frame.centerY );

	const orbVisuals = createOrbVisuals( { scene, config, quality, collider } );
	engine.addSystem( orbVisuals );

	const studio = createSnowLightStudio( { scene, renderer, config, orbLight: orbVisuals.light } );
	engine.trackDisposable( studio );

	const deepBlueShafts = ( config.light.deepBlueShafts || [] ).map( ( cfg ) => {

		const s = createLightShaft( {
			scene,
			camera,
			apex: cfg.apex,
			target: cfg.target,
			angle: cfg.angle,
			color: cfg.color,
			rimTint: cfg.rimTint,
			strength: cfg.strength,
			blurGrowth: cfg.blurGrowth,
			renderOrder: 1
		} );
		engine.trackDisposable( s );
		return s;

	} );

	const shaft = createLightShaft( {
		scene,
		camera,
		apex: config.light.spot.position,
		target: config.light.spot.target,
		angle: config.light.spot.angle,
		color: config.light.spot.color,
		strength: config.light.shaft,
		renderOrder: 2
	} );
	engine.trackDisposable( shaft );

	const swarm = createSnowSwarm( {
		scene,
		overlayScene,
		config,
		quality,
		collider,
		orbLight: orbVisuals.light,
		rig: studio.rig,
		environment: studio.environment,
		lens: post.lens,
		frame
	} );
	engine.addSystem( swarm );

	engine.onUpdate( () => {

		studio.update( orbVisuals.reveal );
		for ( const s of deepBlueShafts ) s.update( orbVisuals.reveal );
		shaft.update( orbVisuals.reveal );

	} );

	engine.setPostStateProvider( () => ( {
		focusWorldPoint: collider.position,
		hazeWorldPos: collider.position,
		hazeLightColor: orbVisuals.light.color,
		hazeIntensity: orbVisuals.light.intensity
	} ) );

	engine.start();

	return {
		engine,
		collider,
		orbVisuals,
		studio,
		swarm,
		dispose: () => engine.dispose()
	};

}
