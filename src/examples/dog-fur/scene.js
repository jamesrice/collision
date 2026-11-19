import * as THREE from 'three/webgpu';
import {
	createCollisionEngine,
	createGoboSpotLight,
	createProceduralEnvironment,
	createLightShaft
} from '../../engine/index.js';
import { DOG_FUR_CONFIG } from './config.js';
import { createDogBody, evalDogSurface } from './body.js';
import { createDogFurSystem } from './fur.js';

// "Petting Fur" — tactile macro interactive dog coat experience designed for
// touch screens (multi-touch petting up to 3 fingers) and pointer interfaces.
// Morphs live between Black Labrador, Husky, and Bernese Mountain Dog coats.

export async function createDogFurExperience( { container, config = DOG_FUR_CONFIG } ) {

	const engine = await createCollisionEngine( {
		container,
		background: config.background,
		tiers: config.tiers,
		camera: config.camera,
		post: config.post,
		enableOverlayScene: true
	} );

	const { renderer, scene, overlayScene, camera, quality, post } = engine;

	// ---- Golden-hour living room studio lighting ----
	const envTarget = createProceduralEnvironment( renderer, config.light.environment );
	const environment = envTarget.texture;
	engine.trackDisposable( { dispose: () => envTarget.dispose() } );

	const keyCfg = config.light.key;
	const keyRig = createGoboSpotLight( {
		scene,
		position: keyCfg.position,
		target: keyCfg.target,
		color: keyCfg.color,
		intensity: keyCfg.intensity,
		angle: keyCfg.angle,
		penumbra: keyCfg.penumbra,
		decay: keyCfg.decay,
		goboScale: 1.65,
		goboSpeed: 0.018,
		goboContrast: 0.24,
		rimTint: [ 1.0, 0.84, 0.56 ]
	} );
	keyRig.spot.castShadow = true;
	keyRig.spot.shadow.mapSize.setScalar( quality.shadowMap || 1536 );
	keyRig.spot.shadow.bias = keyCfg.shadowBias;
	keyRig.spot.shadow.normalBias = keyCfg.shadowNormalBias;
	keyRig.spot.shadow.camera.near = 1.0;
	keyRig.spot.shadow.camera.far = keyCfg.distance;

	const rimCfg = config.light.rim;
	const rimLight = new THREE.PointLight( rimCfg.color, rimCfg.intensity, rimCfg.distance, rimCfg.decay );
	rimLight.position.fromArray( rimCfg.position );
	scene.add( rimLight );

	const fillCfg = config.light.fill;
	const fillLight = new THREE.PointLight( fillCfg.color, fillCfg.intensity, fillCfg.distance, fillCfg.decay );
	fillLight.position.fromArray( fillCfg.position );
	scene.add( fillLight );

	const hemiCfg = config.light.hemisphere;
	const hemiLight = new THREE.HemisphereLight( hemiCfg.sky, hemiCfg.ground, hemiCfg.intensity );
	scene.add( hemiLight );

	// Subtle warm haptic light hovering gently above the active petting fingertip
	const touchCfg = config.light.touchLight;
	const touchLight = new THREE.PointLight( touchCfg.color, 0, touchCfg.distance, touchCfg.decay );
	touchLight.position.set( 0, 0.4, 1.2 );
	scene.add( touchLight );

	const sceneLights = [ keyRig.spot, rimLight, fillLight, hemiLight, touchLight ];

	engine.trackDisposable( {
		dispose() {

			scene.remove( keyRig.spot, keyRig.spot.target, rimLight, fillLight, hemiLight, touchLight );
			keyRig.spot.dispose();
			rimLight.dispose();
			fillLight.dispose();
			hemiLight.dispose();
			touchLight.dispose();

		}
	} );

	// ---- Warm afternoon sunbeams softly filtering behind the backlit fur crest ----
	const sunShafts = ( config.light.sunShafts || [] ).map( ( cfg ) => {

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

	// ---- Curved canine body undercoat & GPU fur coat + floating sunlit motes ----
	const dogBody = createDogBody( { scene, config, environment, sceneLights } );
	engine.trackDisposable( dogBody );

	const fur = createDogFurSystem( {
		scene,
		overlayScene,
		config,
		quality,
		environment,
		sceneLights,
		keyLightPos: keyRig.spot.position,
		rimLightPos: rimLight.position,
		lens: post.lens
	} );
	engine.addSystem( fur );

	// ---- Multi-touch & pointer surface petting tracker (up to 3 simultaneous fingers) ----
	const MAX_SLOTS = config.interaction.maxTouches || 3;
	const slots = Array.from( { length: MAX_SLOTS }, () => ( {
		pointerId: null,
		isMouse: false,
		active: false,
		activeSmooth: 0,
		pressure: 1.0,
		pos: new THREE.Vector3( 0, - 99, 0 ),
		prevPos: new THREE.Vector3( 0, - 99, 0 ),
		targetPos: new THREE.Vector3( 0, 0.1, 0.65 ),
		vel: new THREE.Vector3(),
		lastMoveTime: - 10
	} ) );

	const raycaster = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const fallbackPlane = new THREE.Plane( new THREE.Vector3( 0, 0.25, 0.968 ).normalize(), - 0.58 );
	const hitScratch = new THREE.Vector3();
	const autoPos = new THREE.Vector3();
	const autoNorm = new THREE.Vector3();

	let mouseDown = false;
	let hasUserInteracted = false;
	let lastInteractElapsed = - 10;
	let elapsedNow = 0;

	function projectToDogSurface( clientX, clientY, out ) {

		const rect = container.getBoundingClientRect();
		if ( rect.width <= 0 || rect.height <= 0 ) return false;

		ndc.x = ( ( clientX - rect.left ) / rect.width ) * 2 - 1;
		ndc.y = - ( ( clientY - rect.top ) / rect.height ) * 2 + 1;

		raycaster.setFromCamera( ndc, camera );
		const hits = raycaster.intersectObject( dogBody.mesh, false );
		if ( hits.length > 0 ) {

			out.copy( hits[ 0 ].point );
			return true;

		}

		// Graceful fallback across the sunlit top silhouette crest so sweeping fingers
		// right along the glowing ridge still brushes those backlit guard hairs!
		if ( raycaster.ray.intersectPlane( fallbackPlane, hitScratch ) ) {

			out.copy( hitScratch );
			return true;

		}

		return false;

	}

	function findSlotByPointer( id ) {

		for ( const s of slots ) if ( s.pointerId === id ) return s;
		return null;

	}

	function acquireSlot( pointerId, isMouse ) {

		const existing = findSlotByPointer( pointerId );
		if ( existing ) return existing;

		// Prefer inactive slots first
		for ( const s of slots ) {

			if ( ! s.active && s.pointerId === null ) {

				s.pointerId = pointerId;
				s.isMouse = isMouse;
				return s;

			}

		}

		// Touch takes priority over hover mouse slot
		if ( ! isMouse ) {

			for ( const s of slots ) {

				if ( s.isMouse ) {

					s.pointerId = pointerId;
					s.isMouse = false;
					return s;

				}

			}

		}

		return null;

	}

	function releaseSlot( pointerId ) {

		const s = findSlotByPointer( pointerId );
		if ( ! s ) return;
		s.active = false;
		s.pointerId = null;
		s.isMouse = false;

	}

	let lastPointerTouchDownMs = - Infinity;
	let lastPointerTouchMoveMs = - Infinity;

	function updateSlotFromPoint( slot, clientX, clientY, pressureVal, snapIfInactive ) {

		if ( ! projectToDogSurface( clientX, clientY, hitScratch ) ) return;

		const wasInactive = ! slot.active;
		slot.targetPos.copy( hitScratch );
		if ( snapIfInactive && wasInactive ) {

			slot.pos.copy( hitScratch );
			slot.prevPos.copy( hitScratch );
			slot.vel.set( 0, 0, 0 );

		}

		slot.active = true;
		slot.lastMoveTime = elapsedNow;
		slot.pressure = pressureVal;
		hasUserInteracted = true;
		lastInteractElapsed = elapsedNow;

	}

	function onPointerDown( e ) {

		// Ignore taps on HUD controls overlaid above the canvas
		if ( e.target !== container && ! container.contains( e.target ) ) return;

		hasUserInteracted = true;
		lastInteractElapsed = elapsedNow;

		const isMouse = e.pointerType === 'mouse';
		if ( isMouse ) {

			mouseDown = true;

		} else {

			lastPointerTouchDownMs = performance.now();

		}

		const key = isMouse ? 'mouse' : e.pointerId;
		const slot = acquireSlot( key, isMouse );
		if ( ! slot ) return;

		if ( ! isMouse ) {

			const capTarget = e.target && e.target.setPointerCapture ? e.target : container;
			if ( capTarget.setPointerCapture ) {

				try { capTarget.setPointerCapture( e.pointerId ); } catch {}

			}

		}

		const nativeP = typeof e.pressure === 'number' && e.pressure > 0.05 ? e.pressure : 0.5;
		const press = isMouse ? 1.32 : ( 0.88 + nativeP * 0.65 );
		updateSlotFromPoint( slot, e.clientX, e.clientY, press, true );

	}

	function onPointerMove( e ) {

		const isMouse = e.pointerType === 'mouse';
		const key = isMouse ? 'mouse' : e.pointerId;

		if ( ! isMouse ) lastPointerTouchMoveMs = performance.now();

		let slot = findSlotByPointer( key );
		if ( ! slot && isMouse ) {

			// Desktop hover glides gently over the fur without needing click-hold
			if ( e.target !== container && ! container.contains( e.target ) ) return;
			slot = acquireSlot( 'mouse', true );

		} else if ( ! slot && ! isMouse && ( e.buttons > 0 || e.pressure > 0 ) ) {

			// Recover seamlessly if a desktop browser changed pointerId or dropped capture mid-swipe
			if ( e.target === container || container.contains( e.target ) ) {

				slot = acquireSlot( key, false );

			}

		}
		if ( ! slot ) return;

		const coalesced = ! isMouse && e.getCoalescedEvents ? e.getCoalescedEvents() : null;
		const sample = coalesced && coalesced.length > 0 ? coalesced[ coalesced.length - 1 ] : e;

		let press;
		if ( isMouse ) {

			press = mouseDown ? 1.35 : 0.85;

		} else {

			const nativeP = typeof sample.pressure === 'number' && sample.pressure > 0.05 ? sample.pressure : 0.55;
			press = 0.88 + nativeP * 0.65;

		}

		updateSlotFromPoint( slot, sample.clientX, sample.clientY, press, true );

	}

	function onPointerUp( e ) {

		const isMouse = e.pointerType === 'mouse';
		if ( isMouse ) {

			mouseDown = false;
			const slot = findSlotByPointer( 'mouse' );
			if ( slot ) slot.pressure = 0.85;
			return;

		}

		releaseSlot( e.pointerId );

	}

	function onPointerLeave() {

		mouseDown = false;
		releaseSlot( 'mouse' );

	}

	// Non-passive TouchEvent guard + deduplicated fallback for desktop touchscreens
	// (e.g., Chrome on touchscreen laptops). Prevents browser scroll/back-swipe hijacking
	// while remaining completely transparent to iOS Pointer Events and mouse/trackpad input.
	function onTouchStart( e ) {

		if ( e.target !== container && ! container.contains( e.target ) ) return;
		if ( e.cancelable ) e.preventDefault();

		if ( ( performance.now() - lastPointerTouchDownMs ) < 32 ) return;

		for ( const t of e.changedTouches ) {

			const slot = acquireSlot( `touch:${ t.identifier }`, false );
			if ( ! slot ) continue;
			const force = typeof t.force === 'number' && t.force > 0.05 ? t.force : 0.5;
			updateSlotFromPoint( slot, t.clientX, t.clientY, 0.88 + force * 0.65, true );

		}

	}

	function onTouchMove( e ) {

		if ( e.target !== container && ! container.contains( e.target ) ) return;
		if ( e.cancelable ) e.preventDefault();

		// When Pointer Events are actively delivering moves (e.g., iPhone), avoid duplicate updates
		if ( ( performance.now() - lastPointerTouchMoveMs ) < 40 ) return;

		// Release any stale PointerEvent touch slots whose pointermove stream stalled
		for ( const s of slots ) {

			if ( s.pointerId !== null && ! s.isMouse && typeof s.pointerId !== 'string' ) {

				s.active = false;
				s.pointerId = null;

			}

		}

		for ( const t of e.touches ) {

			const slot = acquireSlot( `touch:${ t.identifier }`, false );
			if ( ! slot ) continue;
			const force = typeof t.force === 'number' && t.force > 0.05 ? t.force : 0.55;
			updateSlotFromPoint( slot, t.clientX, t.clientY, 0.88 + force * 0.65, true );

		}

	}

	function onTouchEnd( e ) {

		for ( const t of e.changedTouches ) releaseSlot( `touch:${ t.identifier }` );

	}

	container.addEventListener( 'pointerdown', onPointerDown );
	window.addEventListener( 'pointermove', onPointerMove, { passive: true } );
	window.addEventListener( 'pointerup', onPointerUp, { passive: true } );
	window.addEventListener( 'pointercancel', onPointerUp, { passive: true } );
	container.addEventListener( 'pointerleave', onPointerLeave );
	container.addEventListener( 'touchstart', onTouchStart, { passive: false } );
	container.addEventListener( 'touchmove', onTouchMove, { passive: false } );
	container.addEventListener( 'touchend', onTouchEnd, { passive: true } );
	container.addEventListener( 'touchcancel', onTouchEnd, { passive: true } );

	engine.trackDisposable( {
		dispose() {

			container.removeEventListener( 'pointerdown', onPointerDown );
			window.removeEventListener( 'pointermove', onPointerMove );
			window.removeEventListener( 'pointerup', onPointerUp );
			window.removeEventListener( 'pointercancel', onPointerUp );
			container.removeEventListener( 'pointerleave', onPointerLeave );
			container.removeEventListener( 'touchstart', onTouchStart );
			container.removeEventListener( 'touchmove', onTouchMove );
			container.removeEventListener( 'touchend', onTouchEnd );
			container.removeEventListener( 'touchcancel', onTouchEnd );

		}
	} );

	// ---- Sunbeam warmth lighting controller ----
	let sunWarmth = config.interaction.defaultWarmth;
	const coolKeyColor = new THREE.Color( 0xd8e6ff );
	const warmKeyColor = new THREE.Color( 0xffca84 );
	const coolRimColor = new THREE.Color( 0xb6d4ff );
	const warmRimColor = new THREE.Color( 0xffaa52 );

	function applySunWarmthLighting( w ) {

		const t = THREE.MathUtils.clamp( ( w - 0.25 ) / 1.4, 0, 1 );
		keyRig.spot.color.copy( coolKeyColor ).lerp( warmKeyColor, t );
		keyRig.spot.intensity = keyCfg.intensity * ( 0.65 + 0.52 * w );
		rimLight.color.copy( coolRimColor ).lerp( warmRimColor, t );
		rimLight.intensity = rimCfg.intensity * ( 0.52 + 0.68 * w );
		hemiLight.intensity = hemiCfg.intensity * ( 0.78 + 0.25 * w );

	}
	applySunWarmthLighting( sunWarmth );

	// ---- Focus & parallax tracking ----
	const focusPoint = new THREE.Vector3( 0, 0.14, 0.68 );
	const parallaxTarget = new THREE.Vector3( 0, 0.10, 0.5 );

	engine.setCameraFocusProvider( () => parallaxTarget );

	engine.onUpdate( ( dt, elapsed ) => {

		elapsedNow = elapsed;

		// Keep undercoat markings and breathing synced smoothly with fur coat
		const weights = fur.getBreedWeights();
		dogBody.setBreedWeights( weights.labrador, weights.husky, weights.bernese );
		dogBody.update( elapsed );

		for ( const s of sunShafts ) s.update( fur.reveal * sunWarmth );

		// Idle gentle invisible petting caress when untouched for a few seconds so
		// first-time visitors immediately feel the living softness of the coat
		const idleSeconds = elapsed - lastInteractElapsed;
		const useAutopilot = ! hasUserInteracted || idleSeconds > 5.5;

		let primarySlot = null;
		let strongestActive = 0;

		for ( let i = 0; i < MAX_SLOTS; i ++ ) {

			const slot = slots[ i ];

			// Fade desktop hover slot softly if mouse stops moving for > 2.4s without press
			if ( slot.isMouse && slot.active && ! mouseDown && ( elapsed - slot.lastMoveTime ) > 2.4 ) {

				slot.active = false;

			}

			if ( i === 0 && useAutopilot && ! slot.active ) {

				// Slow, affectionate figure-eight petting stroke along the dog's shoulder & back
				const phase = elapsed * 0.68;
				const uAuto = Math.sin( phase ) * 0.52;
				const vAuto = 0.08 + Math.sin( phase * 2.0 ) * 0.26;
				evalDogSurface( uAuto, vAuto, autoPos, autoNorm, null );

				slot.prevPos.copy( slot.pos );
				if ( slot.pos.y < - 20 ) {

					slot.pos.copy( autoPos );
					slot.prevPos.copy( autoPos );

				} else {

					slot.pos.lerp( autoPos, 1 - Math.exp( - dt * 8.0 ) );

				}

				slot.vel.subVectors( slot.pos, slot.prevPos ).divideScalar( Math.max( dt, 1 / 240 ) );
				slot.vel.clampLength( 0, 4.5 );
				const autoStrength = 0.58 * ( 0.65 + 0.35 * Math.cos( phase ) );
				slot.activeSmooth += ( autoStrength - slot.activeSmooth ) * ( 1 - Math.exp( - dt * 5.0 ) );

			} else {

				slot.prevPos.copy( slot.pos );
				const followK = 1 - Math.exp( - dt * 22.0 );
				slot.pos.lerp( slot.targetPos, followK );

				if ( slot.active ) {

					slot.vel.subVectors( slot.pos, slot.prevPos ).divideScalar( Math.max( dt, 1 / 240 ) );
					slot.vel.clampLength( 0, 6.5 );

				} else {

					slot.vel.multiplyScalar( Math.exp( - dt * 12.0 ) );

				}

				const targetA = slot.active ? slot.pressure : 0;
				const fadeRate = slot.active ? 16.0 : 6.5;
				slot.activeSmooth += ( targetA - slot.activeSmooth ) * ( 1 - Math.exp( - dt * fadeRate ) );

			}

			fur.setTouchSlot( i, slot.pos, slot.vel, slot.activeSmooth );

			if ( slot.activeSmooth > strongestActive ) {

				strongestActive = slot.activeSmooth;
				primarySlot = slot;

			}

		}

		// Smoothly float warm haptic touch pool & camera focus around active petting zone
		if ( primarySlot && strongestActive > 0.04 ) {

			touchLight.position.lerp(
				hitScratch.copy( primarySlot.pos ).add( new THREE.Vector3( 0, 0.22, 0.42 ) ),
				1 - Math.exp( - dt * 10.0 )
			);
			const targetLightInt = touchCfg.activeIntensity * Math.min( 1.25, strongestActive ) * ( 0.45 + 0.55 * sunWarmth );
			touchLight.intensity += ( targetLightInt - touchLight.intensity ) * ( 1 - Math.exp( - dt * 8.0 ) );

			parallaxTarget.lerp( primarySlot.pos, 1 - Math.exp( - dt * 3.5 ) );
			focusPoint.lerp( primarySlot.pos, 1 - Math.exp( - dt * 4.5 ) );

		} else {

			touchLight.intensity *= Math.exp( - dt * 6.0 );
			parallaxTarget.lerp( hitScratch.set( 0, 0.10, 0.55 ), 1 - Math.exp( - dt * 2.0 ) );
			focusPoint.lerp( hitScratch.set( 0, 0.14, 0.68 ), 1 - Math.exp( - dt * 2.0 ) );

		}

	} );

	engine.setPostStateProvider( () => ( {
		focusWorldPoint: focusPoint,
		hazeWorldPos: keyRig.spot.position,
		hazeLightColor: keyRig.spot.color,
		hazeIntensity: 0.75 * sunWarmth
	} ) );

	engine.start();

	return {
		engine,
		dogBody,
		fur,
		setBreed( breed ) {

			fur.setBreed( breed );

		},
		setTouchPressure( v ) {

			fur.setTouchPressure( v );

		},
		setCoatSoftness( v ) {

			fur.setCoatSoftness( v );

		},
		setSunbeamWarmth( v ) {

			sunWarmth = Math.max( 0.2, Math.min( 2.2, v ) );
			fur.setSunWarmth( sunWarmth );
			dogBody.setSunWarmth( sunWarmth );
			applySunWarmthLighting( sunWarmth );

		},
		triggerShakeOff() {

			fur.triggerShakeOff();

		},
		triggerSmoothCoat() {

			fur.triggerSmoothCoat();

		},
		dispose: () => engine.dispose()
	};

}
