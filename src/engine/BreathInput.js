// 3-Phase Breath Microphone Input Controller:
//   Phase 0 ('off'):    Microphone closed (MediaStreamTracks stopped, OS mic indicator off).
//   Phase 1 ('breeze'): Soft blowing creates living wind around pointer/hand; strong puff triggers
//                       Pulse (Moss), Frost Gust (Snow), or Shake Off (Petting Fur).
//   Phase 2 ('steer'):  Everything in Breeze + breath spectral brightness ("whooo" vs. "shhhh", or
//                       true L/R balance on stereo mics) steers the interaction horizontally hands-free.

const MODES = [ 'off', 'breeze', 'steer' ];

export function createBreathInput( { getAudioOutputLevel = () => 0 } = {} ) {

	let modeIndex = 0; // 0=off, 1=breeze, 2=steer
	let ctx = null;
	let stream = null;
	let source = null;
	let workletNode = null;
	let silentSink = null;
	let starting = null;

	// Adaptive calibration & smoothed DSP state
	let noiseFloor = 0.015;
	let calibFrames = 0;
	let rawEnergy = 0;
	let smoothEnergy = 0;
	let prevEnergy = 0;
	let smoothCentroid = 0.5;
	let smoothStereoPan = 0;
	let hasStereo = false;
	let lastPuffMs = - Infinity;
	let pendingPuff = false;
	let lastError = null;

	function onMetrics( m ) {

		if ( modeIndex === 0 || ! m ) return;

		// Estimate speaker bleed when AudioEngine is also active without headphones
		const speakerDuck = ( getAudioOutputLevel ? getAudioOutputLevel() : 0 ) * 0.24;

		// Separate turbulent airflow (breath) from narrow voiced speech/hum:
		// Breath has balanced low+mid+high airflow turbulence; speech concentrates strongly in mid formants.
		const totalBand = m.eLow + m.eMid + m.eHigh + 1e-5;
		const lowRatio = m.eLow / totalBand;
		const highRatio = m.eHigh / totalBand;
		const airflowScore = Math.min( 1, ( lowRatio * 1.1 + highRatio * 1.45 ) * 1.35 );

		// Initial ~0.5s quiet room calibration, then gentle slow drift adaptation when calm
		if ( calibFrames < 24 ) {

			noiseFloor = calibFrames === 0 ? Math.max( 0.005, m.rms ) : ( noiseFloor * 0.82 + m.rms * 0.18 );
			calibFrames ++;
			rawEnergy = 0;
			return;

		}

		const floorThreshold = Math.max( 0.008, noiseFloor * 1.65 + speakerDuck );
		const aboveFloor = Math.max( 0, m.rms - floorThreshold );

		if ( aboveFloor < 0.004 ) {

			// Calm room — slowly adapt floor down or up
			noiseFloor = noiseFloor * 0.992 + m.rms * 0.008;

		}

		// Scale normalized breath energy smoothly into [0, 1]
		const scaled = Math.min( 1, ( aboveFloor / 0.13 ) * ( 0.45 + 0.55 * airflowScore ) );
		rawEnergy = scaled;

		// Track spectral brightness ("whooo" ~ 0.12 .. "shhhh" ~ 0.85) & stereo balance when actively blowing
		hasStereo = Boolean( m.hasStereo );
		if ( scaled > 0.08 ) {

			smoothCentroid += ( m.centroid - smoothCentroid ) * 0.22;
			if ( hasStereo ) {

				smoothStereoPan += ( Math.max( - 1, Math.min( 1, m.stereoPan * 2.4 ) ) - smoothStereoPan ) * 0.26;

			}

		}

		// Strong breath puff peak detection with 1.45s low-cortisol cooldown
		const now = performance.now();
		const rise = scaled - prevEnergy;
		if ( scaled > 0.58 && rise > 0.10 && ( now - lastPuffMs ) > 1450 ) {

			lastPuffMs = now;
			pendingPuff = true;

		}
		prevEnergy = scaled;

	}

	async function startMic() {

		if ( stream && workletNode ) return true;
		if ( starting ) return starting;

		starting = ( async () => {

			if ( ! navigator.mediaDevices || ! navigator.mediaDevices.getUserMedia ) {

				throw new Error( 'Microphone access is not supported in this browser.' );

			}

			// Disable browser noiseSuppression so blowing into the mic isn't stripped as fan noise
			stream = await navigator.mediaDevices.getUserMedia( {
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false,
					channelCount: { ideal: 2 }
				},
				video: false
			} );

			const AudioCtx = window.AudioContext || window.webkitAudioContext;
			ctx = new AudioCtx( { latencyHint: 'interactive' } );
			const workletUrl = new URL( './breath-worklet.js', import.meta.url );
			await ctx.audioWorklet.addModule( workletUrl );

			source = ctx.createMediaStreamSource( stream );
			workletNode = new AudioWorkletNode( ctx, 'breath-analyzer-processor', {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [ 1 ],
				channelCountMode: 'max'
			} );

			// Connect through a zero-gain sink so WebKit/Safari & Chromium always pull the worklet graph
			silentSink = ctx.createGain();
			silentSink.gain.value = 0;

			workletNode.port.onmessage = ( ev ) => onMetrics( ev.data );
			source.connect( workletNode );
			workletNode.connect( silentSink );
			silentSink.connect( ctx.destination );

			if ( ctx.state === 'suspended' ) await ctx.resume();

			calibFrames = 0;
			rawEnergy = 0;
			smoothEnergy = 0;
			prevEnergy = 0;
			pendingPuff = false;
			lastError = null;
			return true;

		} )();

		try {

			return await starting;

		} catch ( err ) {

			lastError = err;
			stopMic();
			throw err;

		} finally {

			starting = null;

		}

	}

	function stopMic() {

		if ( silentSink ) {

			try { silentSink.disconnect(); } catch {}
			silentSink = null;

		}
		if ( workletNode ) {

			try { workletNode.disconnect(); } catch {}
			workletNode = null;

		}
		if ( source ) {

			try { source.disconnect(); } catch {}
			source = null;

		}
		if ( stream ) {

			for ( const t of stream.getTracks() ) {

				try { t.stop(); } catch {}

			}
			stream = null;

		}
		if ( ctx ) {

			try { ctx.close(); } catch {}
			ctx = null;

		}

		rawEnergy = 0;
		smoothEnergy = 0;
		prevEnergy = 0;
		pendingPuff = false;
		calibFrames = 0;

	}

	async function setMode( mode ) {

		const nextIdx = typeof mode === 'number' ? ( mode % 3 ) : Math.max( 0, MODES.indexOf( mode ) );
		if ( nextIdx === 0 ) {

			modeIndex = 0;
			stopMic();
			return 'off';

		}

		await startMic();
		modeIndex = nextIdx;
		return MODES[ modeIndex ];

	}

	async function cycle() {

		const nextIdx = ( modeIndex + 1 ) % MODES.length;
		return setMode( nextIdx );

	}

	function update( dt = 1 / 60 ) {

		if ( modeIndex === 0 ) {

			smoothEnergy = 0;
			pendingPuff = false;
			return {
				mode: 'off',
				active: false,
				energy: 0,
				puff: false,
				steerX: 0,
				steerY: 0,
				centroid: 0.5,
				hasStereo: false
			};

		}

		const rate = rawEnergy > smoothEnergy ? 14.0 : 5.2;
		smoothEnergy += ( rawEnergy - smoothEnergy ) * ( 1 - Math.exp( - dt * rate ) );

		const puff = pendingPuff;
		pendingPuff = false;

		// Horizontal steering in Phase 2 ('steer'):
		//   - Uses true L/R balance if stereo mic hardware is present
		//   - Uses smooth spectral brightness ("whooo" left <-> "shhhh" right) on built-in mono mics
		const centroidX = Math.max( - 0.88, Math.min( 0.88, ( smoothCentroid - 0.44 ) * 2.4 ) );
		const steerX = hasStereo ? smoothStereoPan : centroidX;
		const steerY = Math.max( - 0.45, Math.min( 0.55, ( smoothEnergy - 0.35 ) * 0.75 ) );

		return {
			mode: MODES[ modeIndex ],
			active: true,
			energy: smoothEnergy,
			puff,
			steerX,
			steerY,
			centroid: smoothCentroid,
			hasStereo
		};

	}

	function dispose() {

		modeIndex = 0;
		stopMic();

	}

	return {
		get mode() { return MODES[ modeIndex ]; },
		get modeIndex() { return modeIndex; },
		get active() { return modeIndex > 0; },
		get lastError() { return lastError; },
		setMode,
		cycle,
		update,
		dispose
	};

}
