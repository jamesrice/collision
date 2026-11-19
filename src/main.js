import { parseRuntimeFlags } from './engine/index.js';
import { createMossTreeExperience } from './examples/moss-tree/scene.js';
import { createSnowAndLightExperience } from './examples/snow-and-light/scene.js';
import { createDogFurExperience } from './examples/dog-fur/scene.js';

window.__appBooted = true;

const $ = ( id ) => document.getElementById( id );

const stage = $( 'stage' );
const btnPanel = $( 'btn-toggle-panel' );
const panel = $( 'hud-panel' );
const themeMeta = document.querySelector( 'meta[name="theme-color"]' );

const scorePill = $( 'score-pill' );
const scoreLabel = $( 'score-label' );
const scoreVal = $( 'score-val' );
const comboVal = $( 'combo-val' );
const hint = $( 'hint' );

const statBackend = $( 'stat-backend' );
const statFps = $( 'stat-fps' );
const statBodies = $( 'stat-bodies' );

const errorBanner = $( 'error-banner' );
const errorDetail = $( 'error-detail' );

const DEMOS = {
	moss: {
		btn: $( 'btn-demo-moss' ),
		controls: $( 'moss-only-controls' ),
		themeClass: 'theme-moss',
		themeColor: '#050b07',
		hideCursor: false,
		hint: 'Move pointer or drag to awaken the moss & swirl pappus · Hold to pulse'
	},
	snow: {
		btn: $( 'btn-demo-snow' ),
		controls: $( 'snow-only-controls' ),
		themeClass: 'theme-snow',
		themeColor: '#020712',
		hideCursor: true,
		hint: 'Sweep pointer or finger through the snow · Hold to swell the field'
	},
	dog: {
		btn: $( 'btn-demo-dog' ),
		controls: $( 'dog-only-controls' ),
		themeClass: 'theme-dog',
		themeColor: '#0c0907',
		hideCursor: false,
		hint: 'Pet slowly with one or more fingers to comb & part the coat'
	}
};

// Moss controls
const btnFocusMoss = $( 'btn-focus-moss' );
const btnFocusPointer = $( 'btn-focus-pointer' );
const rangeFocus = $( 'range-focus' );
const valFocus = $( 'val-focus' );
const rangeWind = $( 'range-wind' );
const valWind = $( 'val-wind' );
const rangeGlow = $( 'range-glow' );
const valGlow = $( 'val-glow' );
const btnPulse = $( 'btn-pulse' );
const btnGame = $( 'btn-game' );

// Snow & Light controls
const btnSnowRepel = $( 'btn-snow-repel' );
const btnSnowVortex = $( 'btn-snow-vortex' );
const rangeSnowDrift = $( 'range-snow-drift' );
const valSnowDrift = $( 'val-snow-drift' );
const rangeSnowRays = $( 'range-snow-rays' );
const valSnowRays = $( 'val-snow-rays' );
const rangeSnowRadius = $( 'range-snow-radius' );
const valSnowRadius = $( 'val-snow-radius' );
const btnSnowGust = $( 'btn-snow-gust' );
const btnSnowGame = $( 'btn-snow-game' );

// Dog Fur controls
const breedButtons = {
	labrador: $( 'btn-dog-labrador' ),
	husky: $( 'btn-dog-husky' ),
	bernese: $( 'btn-dog-bernese' )
};
const rangeDogPressure = $( 'range-dog-pressure' );
const valDogPressure = $( 'val-dog-pressure' );
const rangeDogSoftness = $( 'range-dog-softness' );
const valDogSoftness = $( 'val-dog-softness' );
const rangeDogWarmth = $( 'range-dog-warmth' );
const valDogWarmth = $( 'val-dog-warmth' );
const btnDogShake = $( 'btn-dog-shake' );
const btnDogSmooth = $( 'btn-dog-smooth' );

let currentDemo = null;
let currentName = 'moss';
let switching = false;
let hintTimer = null;

function showError( err ) {

	errorDetail.textContent = String( err && err.stack || err );
	errorBanner.hidden = false;

}

function setSegmentedActive( buttons, activeBtn ) {

	for ( const b of buttons ) {

		b.setAttribute( 'aria-pressed', String( b === activeBtn ) );

	}

}

function handleScoreChange( { score, combo, active, label } ) {

	if ( label ) scoreLabel.textContent = label;
	scorePill.hidden = ! active;
	scoreVal.textContent = String( score );
	comboVal.textContent = `x${ Math.max( 1, combo ) }`;

}

function showHint( text ) {

	hint.textContent = text;
	hint.classList.remove( 'is-hidden' );
	if ( hintTimer ) clearTimeout( hintTimer );
	hintTimer = setTimeout( () => hint.classList.add( 'is-hidden' ), 4800 );

}

function updateDemoUI( name ) {

	const spec = DEMOS[ name ] || DEMOS.moss;
	document.body.classList.remove( 'theme-moss', 'theme-snow', 'theme-dog' );
	document.body.classList.add( spec.themeClass );
	if ( themeMeta ) themeMeta.setAttribute( 'content', spec.themeColor );

	for ( const [ key, def ] of Object.entries( DEMOS ) ) {

		def.btn.setAttribute( 'aria-pressed', String( key === name ) );
		def.controls.hidden = key !== name;

	}

	stage.classList.toggle( 'cursor-hidden', spec.hideCursor );
	scorePill.hidden = true;
	showHint( spec.hint );

}

function resetMossControlUI() {

	setSegmentedActive( [ btnFocusMoss, btnFocusPointer ], btnFocusMoss );
	rangeFocus.value = '0';
	valFocus.textContent = '0.00';
	rangeWind.value = '1';
	valWind.textContent = '1.0x';
	rangeGlow.value = '1';
	valGlow.textContent = '1.0x';
	btnGame.setAttribute( 'aria-pressed', 'false' );
	btnGame.classList.remove( 'is-active' );

}

function resetSnowControlUI() {

	setSegmentedActive( [ btnSnowRepel, btnSnowVortex ], btnSnowRepel );
	rangeSnowDrift.value = '1';
	valSnowDrift.textContent = '1.0x';
	rangeSnowRays.value = '1';
	valSnowRays.textContent = '1.0x';
	rangeSnowRadius.value = '1';
	valSnowRadius.textContent = '1.0x';
	btnSnowGame.setAttribute( 'aria-pressed', 'false' );
	btnSnowGame.classList.remove( 'is-active' );

}

function resetDogControlUI( breed = 'labrador' ) {

	const chosen = breedButtons[ breed ] ? breed : 'labrador';
	setSegmentedActive( Object.values( breedButtons ), breedButtons[ chosen ] );
	rangeDogPressure.value = '1';
	valDogPressure.textContent = '1.0x';
	rangeDogSoftness.value = '1';
	valDogSoftness.textContent = '1.0x';
	rangeDogWarmth.value = '1';
	valDogWarmth.textContent = '1.0x';

}

async function mountDemo( name, options = {} ) {

	if ( switching ) return;
	switching = true;

	try {

		if ( currentDemo ) {

			currentDemo.dispose();
			currentDemo = null;

		}

		currentName = name;
		updateDemoUI( name );
		errorBanner.hidden = true;

		if ( name === 'snow' ) {

			resetSnowControlUI();
			currentDemo = await createSnowAndLightExperience( {
				container: stage,
				onScoreChange: handleScoreChange
			} );

		} else if ( name === 'dog' ) {

			const initialBreed = breedButtons[ options.breed ] ? options.breed : 'labrador';
			resetDogControlUI( initialBreed );
			currentDemo = await createDogFurExperience( { container: stage } );
			if ( initialBreed !== 'labrador' ) currentDemo.setBreed( initialBreed );

		} else {

			resetMossControlUI();
			currentDemo = await createMossTreeExperience( {
				container: stage,
				onScoreChange: ( payload ) => handleScoreChange( { ...payload, label: 'Bloom Hunt' } )
			} );

		}

		window.__activeDemo = currentDemo;

	} catch ( err ) {

		console.error( '[app] failed to start demo', err );
		showError( err );

	} finally {

		switching = false;

	}

}

// ------------------------------------------------------------ Shared Binding Helpers

function bindRange( input, readout, format, apply ) {

	input.addEventListener( 'input', () => {

		const v = parseFloat( input.value );
		readout.textContent = format( v );
		apply( v );

	} );

}

function bindGameToggle( button ) {

	button.addEventListener( 'click', () => {

		if ( ! currentDemo?.setGameMode ) return;
		const next = button.getAttribute( 'aria-pressed' ) !== 'true';
		button.setAttribute( 'aria-pressed', String( next ) );
		button.classList.toggle( 'is-active', next );
		currentDemo.setGameMode( next );

	} );

}

// ------------------------------------------------------------ Demo Switcher & Panel

for ( const [ key, def ] of Object.entries( DEMOS ) ) {

	def.btn.addEventListener( 'click', () => {

		if ( currentName !== key ) mountDemo( key );

	} );

}

btnPanel.addEventListener( 'click', () => {

	const open = panel.hidden;
	panel.hidden = ! open;
	btnPanel.setAttribute( 'aria-expanded', String( open ) );

} );

// ------------------------------------------------------------ Moss & Pappus Controls

btnFocusMoss.addEventListener( 'click', () => {

	if ( ! currentDemo?.setFocusMode ) return;
	currentDemo.setFocusMode( 'moss' );
	setSegmentedActive( [ btnFocusMoss, btnFocusPointer ], btnFocusMoss );

} );

btnFocusPointer.addEventListener( 'click', () => {

	if ( ! currentDemo?.setFocusMode ) return;
	currentDemo.setFocusMode( 'pointer' );
	setSegmentedActive( [ btnFocusMoss, btnFocusPointer ], btnFocusPointer );

} );

bindRange( rangeFocus, valFocus, ( v ) => v.toFixed( 2 ), ( v ) => currentDemo?.setFocusOffset?.( v ) );
bindRange( rangeWind, valWind, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setWindScale?.( v ) );
bindRange( rangeGlow, valGlow, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setActivationPersistence?.( v ) );
btnPulse.addEventListener( 'click', () => currentDemo?.triggerPulse?.() );
bindGameToggle( btnGame );

// ------------------------------------------------------------ Snow & Light Controls

btnSnowRepel.addEventListener( 'click', () => {

	if ( ! currentDemo?.setFieldMode ) return;
	currentDemo.setFieldMode( 'repel' );
	setSegmentedActive( [ btnSnowRepel, btnSnowVortex ], btnSnowRepel );

} );

btnSnowVortex.addEventListener( 'click', () => {

	if ( ! currentDemo?.setFieldMode ) return;
	currentDemo.setFieldMode( 'vortex' );
	setSegmentedActive( [ btnSnowRepel, btnSnowVortex ], btnSnowVortex );

} );

bindRange( rangeSnowDrift, valSnowDrift, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setBlizzardDrift?.( v ) );
bindRange( rangeSnowRays, valSnowRays, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setFrozenRays?.( v ) );
bindRange( rangeSnowRadius, valSnowRadius, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setFieldRadius?.( v ) );
btnSnowGust.addEventListener( 'click', () => currentDemo?.triggerFrostGust?.() );
bindGameToggle( btnSnowGame );

// ------------------------------------------------------------ Petting Fur Controls

const allBreedBtns = Object.values( breedButtons );
for ( const [ breedKey, btn ] of Object.entries( breedButtons ) ) {

	btn.addEventListener( 'click', () => {

		if ( ! currentDemo?.setBreed ) return;
		currentDemo.setBreed( breedKey );
		setSegmentedActive( allBreedBtns, btn );

	} );

}

bindRange( rangeDogPressure, valDogPressure, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setTouchPressure?.( v ) );
bindRange( rangeDogSoftness, valDogSoftness, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setCoatSoftness?.( v ) );
bindRange( rangeDogWarmth, valDogWarmth, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setSunbeamWarmth?.( v ) );
btnDogShake.addEventListener( 'click', () => currentDemo?.triggerShakeOff?.() );
btnDogSmooth.addEventListener( 'click', () => currentDemo?.triggerSmoothCoat?.() );

// Dismiss helper hint quickly once the user touches or moves across the stage
function dismissHintSoon() {

	if ( hint.classList.contains( 'is-hidden' ) ) return;
	if ( hintTimer ) clearTimeout( hintTimer );
	hintTimer = setTimeout( () => hint.classList.add( 'is-hidden' ), 1600 );

}
stage.addEventListener( 'pointerdown', dismissHintSoon, { passive: true } );
stage.addEventListener( 'pointermove', dismissHintSoon, { passive: true } );
stage.addEventListener( 'touchstart', dismissHintSoon, { passive: true } );
stage.addEventListener( 'touchmove', dismissHintSoon, { passive: true } );

// Periodic telemetry update
setInterval( () => {

	const stats = currentDemo?.engine?.stats;
	if ( ! stats ) return;

	statBackend.textContent = `${ stats.backend.toUpperCase() } · ${ stats.tier }`;
	statFps.textContent = stats.fps > 0 ? `${ Math.round( stats.fps ) } fps` : 'warming…';
	statBodies.textContent = `${ stats.bodies.toLocaleString() } bodies`;

	if ( stats.error ) showError( stats.error );

}, 500 );

// Boot initial scene (?demo=moss | ?demo=snow | ?demo=dog & optional ?breed=labrador|husky|bernese)
const flags = parseRuntimeFlags();
const urlParams = new URLSearchParams( window.location.search );
const requestedBreed = ( urlParams.get( 'breed' ) || '' ).toLowerCase();

// Opt-in live input event monitor (?debug-input) for diagnosing novel touchscreen hardware
if ( urlParams.has( 'debug-input' ) ) {

	const box = document.createElement( 'pre' );
	box.id = 'input-debug-overlay';
	box.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:30;margin:0;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,0.78);color:#d7f5e5;border:1px solid rgba(255,255,255,0.2);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none;max-width:min(92vw,420px);white-space:pre-wrap;';
	box.textContent = `input-debug ready · maxTouchPoints=${ navigator.maxTouchPoints }`;
	document.body.appendChild( box );

	const rows = [];
	const logEv = ( e ) => {

		const sig = `${ e.type }${ e.pointerType ? `(${ e.pointerType }#${ e.pointerId })` : '' }`;
		const xy = typeof e.clientX === 'number'
			? `${ Math.round( e.clientX ) },${ Math.round( e.clientY ) }`
			: ( e.touches?.[ 0 ] ? `${ Math.round( e.touches[ 0 ].clientX ) },${ Math.round( e.touches[ 0 ].clientY ) }` : '' );
		const extra = e.type === 'wheel'
			? ` d=${ Math.round( e.deltaX ) },${ Math.round( e.deltaY ) }`
			: ( e.touches ? ` n=${ e.touches.length }` : ( typeof e.buttons === 'number' ? ` b=${ e.buttons }` : '' ) );

		if ( rows.length > 0 && rows[ rows.length - 1 ].sig === sig ) {

			rows[ rows.length - 1 ].count ++;
			rows[ rows.length - 1 ].tail = `${ xy }${ extra }`;

		} else {

			rows.push( { sig, count: 1, tail: `${ xy }${ extra }` } );
			if ( rows.length > 9 ) rows.shift();

		}

		box.textContent = `maxTouchPoints=${ navigator.maxTouchPoints }\n` + rows.map( ( r ) => `${ r.sig } x${ r.count } ${ r.tail }` ).join( '\n' );

	};

	for ( const name of [ 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel' ] ) {

		window.addEventListener( name, logEv, { passive: true, capture: true } );

	}

}

function resolveInitialDemo( demoFlag ) {

	if ( demoFlag === 'snow' || demoFlag === 'snow-and-light' || demoFlag === 'light' ) return 'snow';
	if ( demoFlag === 'dog' || demoFlag === 'fur' || demoFlag === 'dog-fur' || demoFlag === 'petting' ) return 'dog';
	return 'moss';

}

mountDemo( resolveInitialDemo( flags.demo ), { breed: requestedBreed } );
