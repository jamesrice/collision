import { parseRuntimeFlags } from './engine/index.js';
import { createMossTreeExperience } from './examples/moss-tree/scene.js';
import { createSnowAndLightExperience } from './examples/snow-and-light/scene.js';

window.__appBooted = true;

const stage = document.getElementById( 'stage' );
const btnMoss = document.getElementById( 'btn-demo-moss' );
const btnSnow = document.getElementById( 'btn-demo-snow' );
const btnPanel = document.getElementById( 'btn-toggle-panel' );
const panel = document.getElementById( 'hud-panel' );
const mossOnlyControls = document.getElementById( 'moss-only-controls' );

const btnFocusMoss = document.getElementById( 'btn-focus-moss' );
const btnFocusPointer = document.getElementById( 'btn-focus-pointer' );
const rangeFocus = document.getElementById( 'range-focus' );
const valFocus = document.getElementById( 'val-focus' );
const rangeWind = document.getElementById( 'range-wind' );
const valWind = document.getElementById( 'val-wind' );
const rangeGlow = document.getElementById( 'range-glow' );
const valGlow = document.getElementById( 'val-glow' );
const btnPulse = document.getElementById( 'btn-pulse' );
const btnGame = document.getElementById( 'btn-game' );

const scorePill = document.getElementById( 'score-pill' );
const scoreVal = document.getElementById( 'score-val' );
const comboVal = document.getElementById( 'combo-val' );
const hint = document.getElementById( 'hint' );

const statBackend = document.getElementById( 'stat-backend' );
const statFps = document.getElementById( 'stat-fps' );
const statBodies = document.getElementById( 'stat-bodies' );

const errorBanner = document.getElementById( 'error-banner' );
const errorDetail = document.getElementById( 'error-detail' );

let currentDemo = null;
let currentName = 'moss';
let switching = false;

function showError( err ) {

	errorDetail.textContent = String( err && err.stack || err );
	errorBanner.hidden = false;

}

function updateDemoButtons( name ) {

	btnMoss.setAttribute( 'aria-pressed', String( name === 'moss' ) );
	btnSnow.setAttribute( 'aria-pressed', String( name === 'snow' ) );
	mossOnlyControls.style.display = name === 'moss' ? 'flex' : 'none';
	stage.classList.toggle( 'cursor-hidden', name === 'snow' );

	if ( name === 'moss' ) {

		hint.textContent = 'Move pointer to awaken the moss & swirl dandelion pappus · Hold click to pulse';

	} else {

		hint.textContent = 'Move pointer to sweep the light through the snow · Hold click to swell the force field';
		scorePill.hidden = true;

	}

}

function resetMossControlUI() {

	btnFocusMoss.setAttribute( 'aria-pressed', 'true' );
	btnFocusPointer.setAttribute( 'aria-pressed', 'false' );
	rangeFocus.value = '0';
	valFocus.textContent = '0.00';
	rangeWind.value = '1';
	valWind.textContent = '1.0x';
	rangeGlow.value = '1';
	valGlow.textContent = '1.0x';
	btnGame.setAttribute( 'aria-pressed', 'false' );
	btnGame.classList.remove( 'is-active' );
	scorePill.hidden = true;

}

async function mountDemo( name ) {

	if ( switching ) return;
	switching = true;

	try {

		if ( currentDemo ) {

			currentDemo.dispose();
			currentDemo = null;

		}

		currentName = name;
		updateDemoButtons( name );
		errorBanner.hidden = true;

		if ( name === 'snow' ) {

			currentDemo = await createSnowAndLightExperience( { container: stage } );

		} else {

			resetMossControlUI();
			currentDemo = await createMossTreeExperience( {
				container: stage,
				onScoreChange: ( { score, combo, active } ) => {

					scorePill.hidden = ! active;
					scoreVal.textContent = String( score );
					comboVal.textContent = `x${ Math.max( 1, combo ) }`;

				}
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

// ------------------------------------------------------------ UI Bindings

btnMoss.addEventListener( 'click', () => {

	if ( currentName !== 'moss' ) mountDemo( 'moss' );

} );

btnSnow.addEventListener( 'click', () => {

	if ( currentName !== 'snow' ) mountDemo( 'snow' );

} );

btnPanel.addEventListener( 'click', () => {

	const open = panel.hidden;
	panel.hidden = ! open;
	btnPanel.setAttribute( 'aria-expanded', String( open ) );

} );

btnFocusMoss.addEventListener( 'click', () => {

	if ( ! currentDemo?.setFocusMode ) return;
	currentDemo.setFocusMode( 'moss' );
	btnFocusMoss.setAttribute( 'aria-pressed', 'true' );
	btnFocusPointer.setAttribute( 'aria-pressed', 'false' );

} );

btnFocusPointer.addEventListener( 'click', () => {

	if ( ! currentDemo?.setFocusMode ) return;
	currentDemo.setFocusMode( 'pointer' );
	btnFocusMoss.setAttribute( 'aria-pressed', 'false' );
	btnFocusPointer.setAttribute( 'aria-pressed', 'true' );

} );

rangeFocus.addEventListener( 'input', () => {

	const v = parseFloat( rangeFocus.value );
	valFocus.textContent = v.toFixed( 2 );
	if ( currentDemo?.setFocusOffset ) currentDemo.setFocusOffset( v );

} );

rangeWind.addEventListener( 'input', () => {

	const v = parseFloat( rangeWind.value );
	valWind.textContent = `${ v.toFixed( 1 ) }x`;
	if ( currentDemo?.setWindScale ) currentDemo.setWindScale( v );

} );

rangeGlow.addEventListener( 'input', () => {

	const v = parseFloat( rangeGlow.value );
	valGlow.textContent = `${ v.toFixed( 1 ) }x`;
	if ( currentDemo?.setActivationPersistence ) currentDemo.setActivationPersistence( v );

} );

btnPulse.addEventListener( 'click', () => {

	if ( currentDemo?.triggerPulse ) currentDemo.triggerPulse();

} );

btnGame.addEventListener( 'click', () => {

	if ( ! currentDemo?.setGameMode ) return;
	const next = btnGame.getAttribute( 'aria-pressed' ) !== 'true';
	btnGame.setAttribute( 'aria-pressed', String( next ) );
	btnGame.classList.toggle( 'is-active', next );
	currentDemo.setGameMode( next );

} );

// Fade out the helper hint shortly after the user interacts
let hintHidden = false;
window.addEventListener( 'pointermove', () => {

	if ( hintHidden ) return;
	hintHidden = true;
	setTimeout( () => hint.classList.add( 'is-hidden' ), 2200 );

}, { passive: true } );

// Periodic telemetry update
setInterval( () => {

	const stats = currentDemo?.engine?.stats;
	if ( ! stats ) return;

	statBackend.textContent = `${ stats.backend.toUpperCase() } · ${ stats.tier }`;
	statFps.textContent = stats.fps > 0 ? `${ Math.round( stats.fps ) } fps` : 'warming…';
	statBodies.textContent = `${ stats.bodies.toLocaleString() } bodies`;

	if ( stats.error ) showError( stats.error );

}, 500 );

// Boot initial scene (?demo=snow or default moss; ?demo=light kept as alias)
const flags = parseRuntimeFlags();
const startSnow = flags.demo === 'snow' || flags.demo === 'snow-and-light' || flags.demo === 'light';
mountDemo( startSnow ? 'snow' : 'moss' );
