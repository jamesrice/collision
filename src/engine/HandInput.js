// Lazy-loaded MediaPipe HandLandmarker webcam input with One Euro smoothing,
// independent 5-digit finger tracking, Z-axis camera-distance proximity (pressure/size),
// and distinct gestures (single finger vs. open palm vs. pinch/fist).
//
// Zero network cost until toggled On; tearing down stops all camera MediaStreamTracks.

const MP_VERSION = '0.10.22';
const MP_BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${ MP_VERSION }/vision_bundle.mjs`;
const MP_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${ MP_VERSION }/wasm`;
const MP_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const FINGER_SPECS = [
	{ name: 'thumb', tip: 4, pip: 3, mcp: 2 },
	{ name: 'index', tip: 8, pip: 6, mcp: 5 },
	{ name: 'middle', tip: 12, pip: 10, mcp: 9 },
	{ name: 'ring', tip: 16, pip: 14, mcp: 13 },
	{ name: 'pinky', tip: 20, pip: 18, mcp: 17 }
];

const HAND_EDGES = [
	[ 0, 1 ], [ 1, 2 ], [ 2, 3 ], [ 3, 4 ],
	[ 0, 5 ], [ 5, 6 ], [ 6, 7 ], [ 7, 8 ],
	[ 5, 9 ], [ 9, 10 ], [ 10, 11 ], [ 11, 12 ],
	[ 9, 13 ], [ 13, 14 ], [ 14, 15 ], [ 15, 16 ],
	[ 13, 17 ], [ 17, 18 ], [ 18, 19 ], [ 19, 20 ],
	[ 0, 17 ]
];

class OneEuroFilter {

	constructor( minCutoff = 1.2, beta = 0.04, dCutoff = 1.0 ) {

		this.minCutoff = minCutoff;
		this.beta = beta;
		this.dCutoff = dCutoff;
		this.xPrev = null;
		this.dxPrev = 0;
		this.tPrev = null;

	}

	alpha( cutoff, dt ) {

		const tau = 1 / ( 2 * Math.PI * cutoff );
		return 1 / ( 1 + tau / dt );

	}

	reset() {

		this.xPrev = null;
		this.dxPrev = 0;
		this.tPrev = null;

	}

	filter( x, tSec ) {

		if ( this.xPrev === null || this.tPrev === null ) {

			this.xPrev = x;
			this.dxPrev = 0;
			this.tPrev = tSec;
			return x;

		}

		const dt = Math.max( 1 / 240, Math.min( 0.2, tSec - this.tPrev ) );
		this.tPrev = tSec;

		const dx = ( x - this.xPrev ) / dt;
		const aD = this.alpha( this.dCutoff, dt );
		const edx = aD * dx + ( 1 - aD ) * this.dxPrev;
		this.dxPrev = edx;

		const cutoff = this.minCutoff + this.beta * Math.abs( edx );
		const aX = this.alpha( cutoff, dt );
		const out = aX * x + ( 1 - aX ) * this.xPrev;
		this.xPrev = out;
		return out;

	}

}

function dist2( a, b ) {

	return Math.hypot( a.x - b.x, a.y - b.y );

}

function clamp( x, lo, hi ) {

	return x < lo ? lo : ( x > hi ? hi : x );

}

export function createHandInput() {

	let active = false;
	let loading = false;
	let landmarker = null;
	let video = null;
	let stream = null;
	let lastVideoTime = - 1;
	let lastDetectMs = 0;

	// Minimal bottom-left frosted constellation pill (no raw camera video)
	let overlay = null;
	let canvas2d = null;
	let ctx2d = null;
	let labelEl = null;

	// Per-hand smoothers (up to 2 hands x 5 fingertips + palm center + Z proximity)
	const handFilters = [ 0, 1 ].map( () => ( {
		palmX: new OneEuroFilter( 1.3, 0.06 ),
		palmY: new OneEuroFilter( 1.3, 0.06 ),
		prox: new OneEuroFilter( 0.9, 0.02 ),
		pinch: new OneEuroFilter( 1.8, 0.05 ),
		isPinched: false,
		tips: FINGER_SPECS.map( () => ( {
			x: new OneEuroFilter( 1.5, 0.075 ),
			y: new OneEuroFilter( 1.5, 0.075 )
		} ) )
	} ) );

	let prevPrimaryX = null;
	let prevPrimaryY = null;
	let prevSampleSec = null;
	let lastSweepMs = - Infinity;
	let lastPinchEdge = false;
	let lastHandSeenMs = - Infinity;
	let lastRawLandmarks = [];

	// Reusable live state snapshot returned to scenes every frame
	const state = {
		enabled: false,
		loading: false,
		detected: false,
		handCount: 0,
		// Primary hand mirrored screen coords [0..1] & NDC [-1..1]
		x: 0.5,
		y: 0.5,
		ndcX: 0,
		ndcY: 0,
		// Z-axis proximity to camera [0 = far, 1 = close]
		proximity: 0.45,
		// Derived interaction scales driven by Z proximity & posture
		pressureScale: 1.0,
		radiusScale: 1.0,
		// Gesture posture: 'none' | 'point' | 'multi' | 'open' | 'pinch' | 'fist'
		posture: 'none',
		openCount: 0,
		isPinched: false,
		pinchJustStarted: false,
		pinchJustReleased: false,
		sweepTriggered: false,
		// Up to 5 independently tracked active digits across 1–2 hands
		digits: []
	};

	function ensureOverlay() {

		if ( overlay ) return;

		overlay = document.createElement( 'div' );
		overlay.id = 'hand-constellation';
		overlay.style.cssText = [
			'position:fixed',
			'left:max(16px, env(safe-area-inset-left))',
			'bottom:max(16px, env(safe-area-inset-bottom))',
			'z-index:11',
			'width:142px',
			'padding:8px 8px 6px',
			'border-radius:12px',
			'background:var(--glass)',
			'border:1px solid var(--glass-border)',
			'backdrop-filter:blur(14px)',
			'-webkit-backdrop-filter:blur(14px)',
			'box-shadow:0 10px 30px rgba(0,0,0,0.34)',
			'pointer-events:none',
			'display:flex',
			'flex-direction:column',
			'gap:4px',
			'transition:opacity 0.25s ease'
		].join( ';' );

		canvas2d = document.createElement( 'canvas' );
		canvas2d.width = 252;
		canvas2d.height = 148;
		canvas2d.style.cssText = 'width:126px;height:74px;display:block;border-radius:6px;background:rgba(0,0,0,0.24);';
		ctx2d = canvas2d.getContext( '2d' );

		labelEl = document.createElement( 'div' );
		labelEl.style.cssText = 'font-size:12px;line-height:1.2;color:var(--muted);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
		labelEl.textContent = 'loading hands…';

		overlay.appendChild( canvas2d );
		overlay.appendChild( labelEl );
		document.body.appendChild( overlay );

	}

	function removeOverlay() {

		if ( overlay && overlay.parentNode ) overlay.parentNode.removeChild( overlay );
		overlay = null;
		canvas2d = null;
		ctx2d = null;
		labelEl = null;

	}

	function drawConstellation( handsData ) {

		if ( ! ctx2d || ! canvas2d || ! labelEl ) return;

		const W = canvas2d.width;
		const H = canvas2d.height;
		ctx2d.clearRect( 0, 0, W, H );

		const accent = getComputedStyle( document.body ).getPropertyValue( '--accent' ).trim() || '#a6ea57';
		const warm = getComputedStyle( document.body ).getPropertyValue( '--accent-warm' ).trim() || '#f6dc7a';

		if ( loading ) {

			labelEl.textContent = 'loading hands…';
			return;

		}

		if ( ! handsData || handsData.length === 0 ) {

			labelEl.textContent = 'show hand';
			return;

		}

		for ( let hi = 0; hi < handsData.length; hi ++ ) {

			const hd = handsData[ hi ];
			const lms = hd.raw;

			// Draw delicate skeletal filaments (mirrored X)
			ctx2d.strokeStyle = 'rgba(255,255,255,0.26)';
			ctx2d.lineWidth = 2;
			ctx2d.beginPath();
			for ( const [ a, b ] of HAND_EDGES ) {

				const pa = lms[ a ];
				const pb = lms[ b ];
				ctx2d.moveTo( ( 1 - pa.x ) * W, pa.y * H );
				ctx2d.lineTo( ( 1 - pb.x ) * W, pb.y * H );

			}
			ctx2d.stroke();

			// Draw subtle Z-proximity aura around palm center
			const px = hd.palmX * W;
			const py = hd.palmY * H;
			const auraR = 10 + hd.proximity * 22;
			ctx2d.strokeStyle = accent;
			ctx2d.globalAlpha = 0.25 + hd.proximity * 0.45;
			ctx2d.lineWidth = 2;
			ctx2d.beginPath();
			ctx2d.arc( px, py, auraR, 0, Math.PI * 2 );
			ctx2d.stroke();
			ctx2d.globalAlpha = 1;

			// Draw all 5 fingertip nodes (lit bright when extended)
			for ( let fi = 0; fi < FINGER_SPECS.length; fi ++ ) {

				const f = hd.fingers[ fi ];
				const fx = f.x * W;
				const fy = f.y * H;
				ctx2d.fillStyle = f.extended ? ( hd.isPinched && fi <= 1 ? warm : accent ) : 'rgba(255,255,255,0.28)';
				ctx2d.beginPath();
				ctx2d.arc( fx, fy, f.extended ? ( 4.5 + hd.proximity * 2.5 ) : 2.5, 0, Math.PI * 2 );
				ctx2d.fill();

			}

		}

		if ( state.handCount > 1 ) {

			labelEl.textContent = `2 hands · ${ state.digits.length } digits`;

		} else if ( state.posture === 'pinch' ) {

			labelEl.textContent = 'pinch · charge';

		} else if ( state.posture === 'fist' ) {

			labelEl.textContent = 'fist · hold';

		} else if ( state.posture === 'point' ) {

			labelEl.textContent = '1 finger · focus';

		} else if ( state.posture === 'open' ) {

			labelEl.textContent = `${ state.openCount } fingers · open`;

		} else {

			labelEl.textContent = `${ state.openCount } fingers`;

		}

	}

	async function ensureLandmarker() {

		if ( landmarker ) return landmarker;

		const mod = await import( MP_BUNDLE_URL );
		const { FilesetResolver, HandLandmarker } = mod;
		const vision = await FilesetResolver.forVisionTasks( MP_WASM_URL );

		try {

			landmarker = await HandLandmarker.createFromOptions( vision, {
				baseOptions: {
					modelAssetPath: MP_MODEL_URL,
					delegate: 'GPU'
				},
				runningMode: 'VIDEO',
				numHands: 2,
				minHandDetectionConfidence: 0.55,
				minHandPresenceConfidence: 0.50,
				minTrackingConfidence: 0.50
			} );

		} catch {

			// Graceful fallback if WebGL/GPU delegate isn't available on this device
			landmarker = await HandLandmarker.createFromOptions( vision, {
				baseOptions: {
					modelAssetPath: MP_MODEL_URL,
					delegate: 'CPU'
				},
				runningMode: 'VIDEO',
				numHands: 2,
				minHandDetectionConfidence: 0.55,
				minHandPresenceConfidence: 0.50,
				minTrackingConfidence: 0.50
			} );

		}

		return landmarker;

	}

	async function start() {

		if ( active ) return true;
		if ( ! navigator.mediaDevices || ! navigator.mediaDevices.getUserMedia ) {

			throw new Error( 'Webcam access is not supported in this browser.' );

		}

		loading = true;
		state.loading = true;
		ensureOverlay();
		drawConstellation( null );

		try {

			// Request low-bandwidth 640x360 stream (plenty for MediaPipe landmarks, ultra-low CPU/GPU impact)
			const [ mediaStream ] = await Promise.all( [
				navigator.mediaDevices.getUserMedia( {
					video: {
						facingMode: 'user',
						width: { ideal: 640 },
						height: { ideal: 360 },
						frameRate: { ideal: 30 }
					},
					audio: false
				} ),
				ensureLandmarker()
			] );

			stream = mediaStream;
			video = document.createElement( 'video' );
			video.autoplay = true;
			video.playsInline = true;
			video.muted = true;
			video.srcObject = stream;
			await video.play();

			for ( const hf of handFilters ) {

				hf.palmX.reset();
				hf.palmY.reset();
				hf.prox.reset();
				hf.pinch.reset();
				hf.isPinched = false;
				for ( const tf of hf.tips ) { tf.x.reset(); tf.y.reset(); }

			}

			lastVideoTime = - 1;
			prevPrimaryX = null;
			prevPrimaryY = null;
			prevSampleSec = null;
			lastPinchEdge = false;
			lastRawLandmarks = [];
			active = true;
			state.enabled = true;
			loading = false;
			state.loading = false;
			drawConstellation( null );
			return true;

		} catch ( err ) {

			loading = false;
			state.loading = false;
			stop();
			throw err;

		}

	}

	function stop() {

		active = false;
		loading = false;
		state.enabled = false;
		state.loading = false;
		state.detected = false;
		state.handCount = 0;
		state.posture = 'none';
		state.openCount = 0;
		state.isPinched = false;
		state.pinchJustStarted = false;
		state.pinchJustReleased = false;
		state.sweepTriggered = false;
		state.digits = [];

		if ( video ) {

			try { video.pause(); } catch {}
			video.srcObject = null;
			video = null;

		}
		if ( stream ) {

			for ( const t of stream.getTracks() ) {

				try { t.stop(); } catch {}

			}
			stream = null;

		}

		removeOverlay();

	}

	function analyzeHand( lms, hf, tSec ) {

		const wrist = lms[ 0 ];
		const indexMCP = lms[ 5 ];
		const middleMCP = lms[ 9 ];
		const ringMCP = lms[ 13 ];
		const pinkyMCP = lms[ 17 ];

		// Apparent 2D palm scale is an ultra-stable inverse-distance Z proximity metric
		const palmLen = dist2( wrist, middleMCP );
		const palmWid = dist2( indexMCP, pinkyMCP );
		const palmSize = Math.max( 0.04, 0.55 * palmLen + 0.45 * palmWid );
		const rawProx = clamp( ( palmSize - 0.095 ) / 0.19, 0, 1 );
		const proximity = hf.prox.filter( rawProx, tSec );

		// Mirrored palm center (wrist + knuckle centroid)
		const rawPalmX = 1 - ( wrist.x + indexMCP.x + middleMCP.x + ringMCP.x + pinkyMCP.x ) / 5;
		const rawPalmY = ( wrist.y + indexMCP.y + middleMCP.y + ringMCP.y + pinkyMCP.y ) / 5;
		const palmX = clamp( hf.palmX.filter( rawPalmX, tSec ), 0, 1 );
		const palmY = clamp( hf.palmY.filter( rawPalmY, tSec ), 0, 1 );

		// Independent 5-digit extension detection + One Euro smoothed coordinates
		const fingers = [];
		let openCount = 0;

		for ( let fi = 0; fi < FINGER_SPECS.length; fi ++ ) {

			const spec = FINGER_SPECS[ fi ];
			const tip = lms[ spec.tip ];
			const pip = lms[ spec.pip ];
			const mcp = lms[ spec.mcp ];

			let extended;
			if ( fi === 0 ) {

				// Thumb extension: tip reaches well outside palm width relative to IP & index knuckle
				const dTipPinky = dist2( tip, pinkyMCP );
				const dIpPinky = dist2( pip, pinkyMCP );
				const dTipIdx = dist2( tip, indexMCP );
				extended = dTipPinky > dIpPinky * 1.07 && dTipIdx > palmSize * 0.46;

			} else {

				const dTipWrist = dist2( tip, wrist );
				const dPipWrist = dist2( pip, wrist );
				const dMcpWrist = dist2( mcp, wrist );
				extended = dTipWrist > dPipWrist * 1.11 && dTipWrist > dMcpWrist * 1.24;

			}

			if ( extended ) openCount ++;

			const fx = clamp( hf.tips[ fi ].x.filter( 1 - tip.x, tSec ), 0, 1 );
			const fy = clamp( hf.tips[ fi ].y.filter( tip.y, tSec ), 0, 1 );

			fingers.push( {
				name: spec.name,
				index: fi,
				extended,
				x: fx,
				y: fy,
				ndcX: fx * 2 - 1,
				ndcY: 1 - fy * 2
			} );

		}

		// Thumb-index pinch normalized to palm size with clean hysteresis
		const rawPinchRatio = dist2( lms[ 4 ], lms[ 8 ] ) / palmSize;
		const smoothPinch = hf.pinch.filter( rawPinchRatio, tSec );
		if ( ! hf.isPinched && smoothPinch < 0.36 ) hf.isPinched = true;
		else if ( hf.isPinched && smoothPinch > 0.50 ) hf.isPinched = false;

		let posture;
		if ( hf.isPinched ) posture = 'pinch';
		else if ( openCount === 0 ) posture = 'fist';
		else if ( openCount === 1 ) posture = 'point';
		else if ( openCount >= 4 ) posture = 'open';
		else posture = 'multi';

		return {
			raw: lms,
			palmX,
			palmY,
			proximity,
			openCount,
			isPinched: hf.isPinched,
			posture,
			fingers
		};

	}

	function update() {

		// Reset single-frame edge pulses
		state.pinchJustStarted = false;
		state.pinchJustReleased = false;
		state.sweepTriggered = false;

		if ( ! active || ! landmarker || ! video || video.readyState < 2 ) {

			return state;

		}

		const nowMs = performance.now();
		// Cap inference cadence to ~30 Hz (matching webcam framerate) to keep WebGPU at 60–120 fps
		if ( video.currentTime !== lastVideoTime && ( nowMs - lastDetectMs ) >= 26 ) {

			lastVideoTime = video.currentTime;
			lastDetectMs = nowMs;

			let results = null;
			try {

				results = landmarker.detectForVideo( video, nowMs );

			} catch {

				return state;

			}

			const rawHands = ( results && results.landmarks ) ? results.landmarks : [];
			lastRawLandmarks = rawHands;

			if ( rawHands.length > 0 ) {

				lastHandSeenMs = nowMs;
				const tSec = nowMs / 1000;
				const parsed = [];

				for ( let hi = 0; hi < Math.min( 2, rawHands.length ); hi ++ ) {

					parsed.push( analyzeHand( rawHands[ hi ], handFilters[ hi ], tSec ) );

				}

				const primary = parsed[ 0 ];
				state.detected = true;
				state.handCount = parsed.length;
				state.proximity = primary.proximity;
				state.openCount = primary.openCount;
				state.posture = primary.posture;
				state.isPinched = primary.isPinched;

				if ( primary.isPinched && ! lastPinchEdge ) state.pinchJustStarted = true;
				if ( ! primary.isPinched && lastPinchEdge ) state.pinchJustReleased = true;
				lastPinchEdge = primary.isPinched;

				// Cursor X/Y adapts cleanly to posture:
				//   - 1 finger ('point'): locked precisely to that extended fingertip
				//   - pinch: locked to thumb-index midpoint
				//   - open palm / multi / fist: smooth palm/extended-finger centroid
				let cx = primary.palmX;
				let cy = primary.palmY;

				if ( primary.posture === 'point' ) {

					const lone = primary.fingers.find( ( f ) => f.extended ) || primary.fingers[ 1 ];
					cx = lone.x;
					cy = lone.y;

				} else if ( primary.posture === 'pinch' ) {

					cx = 0.5 * ( primary.fingers[ 0 ].x + primary.fingers[ 1 ].x );
					cy = 0.5 * ( primary.fingers[ 0 ].y + primary.fingers[ 1 ].y );

				} else if ( primary.openCount >= 2 ) {

					let sx = 0, sy = 0, n = 0;
					for ( const f of primary.fingers ) {

						if ( f.extended ) { sx += f.x; sy += f.y; n ++; }

					}
					if ( n > 0 ) {

						cx = primary.palmX * 0.35 + ( sx / n ) * 0.65;
						cy = primary.palmY * 0.35 + ( sy / n ) * 0.65;

					}

				}

				state.x = cx;
				state.y = cy;
				state.ndcX = cx * 2 - 1;
				state.ndcY = 1 - cy * 2;

				// Z-axis distance + posture drive pressure & touch area size
				const zPressure = 0.65 + primary.proximity * 1.15; // 0.65x far -> 1.80x close
				const zRadius = 0.72 + primary.proximity * 0.92;   // 0.72x far -> 1.64x close
				const postureRadiusMul = primary.posture === 'point'
					? 0.58
					: ( primary.posture === 'open' ? 1.38 : ( primary.posture === 'pinch' ? 0.85 : 1.0 ) );

				state.pressureScale = zPressure;
				state.radiusScale = clamp( zRadius * postureRadiusMul, 0.45, 2.0 );

				// Detect brisk open-hand wave/sweep for Frost Gust / Shake Off
				if ( prevPrimaryX !== null && prevSampleSec !== null ) {

					const dtS = Math.max( 1 / 120, tSec - prevSampleSec );
					const speed = Math.hypot( cx - prevPrimaryX, cy - prevPrimaryY ) / dtS;
					if ( primary.posture === 'open' && speed > 2.35 && ( nowMs - lastSweepMs ) > 1400 ) {

						lastSweepMs = nowMs;
						state.sweepTriggered = true;

					}

				}
				prevPrimaryX = cx;
				prevPrimaryY = cy;
				prevSampleSec = tSec;

				// Collect up to 5 independently tracked active digits across 1–2 hands
				const digits = [];
				for ( let hi = 0; hi < parsed.length; hi ++ ) {

					const hd = parsed[ hi ];
					if ( hd.posture === 'pinch' ) {

						const mx = 0.5 * ( hd.fingers[ 0 ].x + hd.fingers[ 1 ].x );
						const my = 0.5 * ( hd.fingers[ 0 ].y + hd.fingers[ 1 ].y );
						digits.push( {
							id: `h${ hi }_pinch`,
							x: mx,
							y: my,
							ndcX: mx * 2 - 1,
							ndcY: 1 - my * 2,
							proximity: hd.proximity,
							pressure: ( 0.85 + hd.proximity * 1.05 ) * 1.25,
							radiusMul: 0.75 + hd.proximity * 0.45
						} );

					} else if ( hd.posture === 'fist' ) {

						digits.push( {
							id: `h${ hi }_fist`,
							x: hd.palmX,
							y: hd.palmY,
							ndcX: hd.palmX * 2 - 1,
							ndcY: 1 - hd.palmY * 2,
							proximity: hd.proximity,
							pressure: ( 0.9 + hd.proximity * 1.15 ) * 1.2,
							radiusMul: 1.15 + hd.proximity * 0.55
						} );

					} else {

						for ( const f of hd.fingers ) {

							if ( ! f.extended ) continue;
							if ( digits.length >= 5 ) break;
							digits.push( {
								id: `h${ hi }_${ f.name }`,
								x: f.x,
								y: f.y,
								ndcX: f.ndcX,
								ndcY: f.ndcY,
								proximity: hd.proximity,
								pressure: 0.70 + hd.proximity * 1.05,
								radiusMul: hd.posture === 'point' ? ( 0.55 + hd.proximity * 0.45 ) : ( 0.75 + hd.proximity * 0.55 )
							} );

						}

					}

				}

				state.digits = digits;
				drawConstellation( parsed );

			} else if ( ( nowMs - lastHandSeenMs ) > 260 ) {

				state.detected = false;
				state.handCount = 0;
				state.posture = 'none';
				state.openCount = 0;
				state.isPinched = false;
				state.digits = [];
				lastPinchEdge = false;
				prevPrimaryX = null;
				prevPrimaryY = null;
				drawConstellation( null );

			}

		}

		return state;

	}

	function dispose() {

		stop();
		if ( landmarker ) {

			try { landmarker.close(); } catch {}
			landmarker = null;

		}

	}

	return {
		get active() { return active; },
		get loading() { return loading; },
		get state() { return state; },
		start,
		stop,
		toggle: () => ( active ? ( stop(), Promise.resolve( false ) ) : start() ),
		update,
		dispose
	};

}
