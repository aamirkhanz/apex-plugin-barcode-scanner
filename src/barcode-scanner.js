/*
 * Barcode Scanner item plug-in for Oracle APEX (TechRevX, www.techrevx.com)
 *
 * techrevx.barcodeScanner.init( itemName, options, initFn ) is called by the render procedure. The item is a normal
 * text field (#<itemName>) with a Scan button (#<itemName>_scan) that opens a camera dialog. Codes are read with
 * barcode-detector (a BarcodeDetector for every browser, MIT) on zxing-wasm (MIT); the .wasm file is a plugin file.
 *
 * techrevx.barcodeScanner.get( itemName ).open() / close() / scanImage( fileOrBlob )
 * Events on the item: change, tx-barcode-scan { value, format }.
 */
( function( $, apex ) {
    "use strict";

    const ns = window.techrevx = window.techrevx || {},
        FORMATS = { qr: "qr_code", ean13: "ean_13", ean8: "ean_8", upcA: "upc_a", upcE: "upc_e", code128: "code_128", code39: "code_39",
            code93: "code_93", codabar: "codabar", itf: "itf", dataMatrix: "data_matrix", pdf417: "pdf417", aztec: "aztec" },
        LABELS = { qr_code: "QR Code", ean_13: "EAN-13", ean_8: "EAN-8", upc_a: "UPC-A", upc_e: "UPC-E", code_128: "Code 128", code_39: "Code 39",
            code_93: "Code 93", codabar: "Codabar", itf: "ITF", data_matrix: "Data Matrix", pdf417: "PDF417", aztec: "Aztec" },
        MATRIX = [ "qr_code", "data_matrix", "aztec", "pdf417" ],
        REPEAT_MS = 2000;
    let wasmConfigured = false;

    function el( tag, cls, text ) {
        const e = document.createElement( tag );
        if ( cls ) { e.className = cls; }
        if ( text != null ) { e.textContent = text; }
        return e;
    }

    function iconButton( cls, icon, label ) {
        const b = el( "button", "tx-ScanDlg-btn " + cls ), i = el( "span", "fa " + icon );
        b.type = "button";
        i.setAttribute( "aria-hidden", "true" );
        b.append( i, el( "span", null, label ) );
        return b;
    }

    // the reader loads its WebAssembly from the plugin's files instead of a CDN
    function detectorFor( formats, filePrefix ) {
        const api = window.BarcodeDetectionAPI;
        if ( !wasmConfigured ) {
            const base = new URL( filePrefix, document.baseURI ).href;
            api.setZXingModuleOverrides( { locateFile: ( path, prefix ) => path.endsWith( ".wasm" ) ? base + path : prefix + path } );
            wasmConfigured = true;
        }
        return new api.BarcodeDetector( { formats } );
    }

    class Scanner {
        constructor( itemName, options ) {
            this.name = itemName;
            this.o = options;
            this.input = document.getElementById( itemName );
            this.button = document.getElementById( itemName + "_scan" );
            this.formats = String( options.formats || "qr" ).split( ":" ).map( f => FORMATS[ f ] ).filter( Boolean );
            this.features = String( options.features || "" ).split( ":" );
            this.feedback = String( options.feedback || "" ).split( ":" );
            this.continuous = options.afterScan === "continue";
            this.isOpen = false;
            this.button.addEventListener( "click", () => this.open() );
        }

        has( f ) { return this.features.includes( f ); }

        get detector() {
            if ( !this._detector ) { this._detector = detectorFor( this.formats, this.o.filePrefix ); }
            return this._detector;
        }

        build() {
            const label = document.getElementById( this.name + "_LABEL" ),
                titleText = this.o.label + ( label ? ": " + label.textContent.replace( /\s*\*\s*$/, "" ).trim() : "" );
            this.root = el( "div", "tx-ScanDlg" );
            this.root.hidden = true;
            const backdrop = el( "div", "tx-ScanDlg-backdrop" );
            backdrop.addEventListener( "click", () => this.close() );

            this.panel = el( "div", "tx-ScanDlg-panel" );
            this.panel.setAttribute( "role", "dialog" );
            this.panel.setAttribute( "aria-modal", "true" );
            const head = el( "div", "tx-ScanDlg-head" ), title = el( "h2", "tx-ScanDlg-title", titleText );
            title.id = this.name + "_scanTitle";
            this.panel.setAttribute( "aria-labelledby", title.id );
            this.closeBtn = el( "button", "tx-ScanDlg-close" );
            this.closeBtn.type = "button";
            this.closeBtn.setAttribute( "aria-label", "Close" );
            this.closeBtn.title = "Close";
            const x = el( "span", "fa fa-times" );
            x.setAttribute( "aria-hidden", "true" );
            this.closeBtn.append( x );
            this.closeBtn.addEventListener( "click", () => this.close() );
            head.append( title, this.closeBtn );

            this.stage = el( "div", "tx-ScanDlg-stage" );
            this.video = el( "video", "tx-ScanDlg-video" );
            this.video.muted = true;
            this.video.playsInline = true;
            this.video.setAttribute( "playsinline", "" );
            this.video.setAttribute( "aria-hidden", "true" );
            this.hit = el( "canvas", "tx-ScanDlg-hit" );
            this.hit.setAttribute( "aria-hidden", "true" );
            const frame = el( "div", "tx-ScanDlg-frame " + ( this.formats.some( f => MATRIX.includes( f ) ) ? "is-square" : "is-wide" ) );
            frame.setAttribute( "aria-hidden", "true" );
            this.msg = el( "p", "tx-ScanDlg-msg" );
            this.msg.setAttribute( "role", "status" );
            this.stage.append( this.video, this.hit, frame, this.msg );

            this.list = el( "ol", "tx-ScanDlg-list" );
            this.list.hidden = true;
            this.list.setAttribute( "aria-label", "Scanned codes" );

            const tools = el( "div", "tx-ScanDlg-tools" );
            if ( this.has( "torch" ) ) {
                this.torchBtn = iconButton( "tx-ScanDlg-torch", "fa-lightbulb-o", "Flashlight" );
                this.torchBtn.hidden = true;
                this.torchBtn.setAttribute( "aria-pressed", "false" );
                this.torchBtn.addEventListener( "click", () => this.toggleTorch() );
                tools.append( this.torchBtn );
            }
            if ( this.has( "switch" ) ) {
                this.switchBtn = iconButton( "tx-ScanDlg-switch", "fa-refresh", "Switch camera" );
                this.switchBtn.hidden = true;
                this.switchBtn.addEventListener( "click", () => this.switchCamera() );
                tools.append( this.switchBtn );
            }
            if ( this.has( "image" ) ) {
                this.fileInput = el( "input", "tx-ScanDlg-file" );
                this.fileInput.type = "file";
                this.fileInput.accept = "image/*";
                this.fileInput.tabIndex = -1;
                this.fileInput.setAttribute( "aria-hidden", "true" );
                this.fileInput.addEventListener( "change", () => {
                    const f = this.fileInput.files && this.fileInput.files[ 0 ];
                    this.fileInput.value = "";
                    if ( f ) { this.scanImage( f ); }
                } );
                this.imageBtn = iconButton( "tx-ScanDlg-image", "fa-image", "Scan an image" );
                this.imageBtn.addEventListener( "click", () => this.fileInput.click() );
                tools.append( this.imageBtn, this.fileInput );
            }
            this.panel.append( head, this.stage, this.list, tools );
            this.panel.addEventListener( "keydown", e => this.onKey( e ) );
            this.root.append( backdrop, this.panel );
            document.body.append( this.root );
        }

        onKey( e ) {
            if ( e.key === "Escape" ) { e.preventDefault(); this.close(); return; }
            if ( e.key !== "Tab" ) { return; }
            // keep the focus inside the dialog
            const items = Array.from( this.panel.querySelectorAll( "button:not([hidden]):not(:disabled)" ) );
            if ( !items.length ) { return; }
            const first = items[ 0 ], last = items[ items.length - 1 ];
            if ( e.shiftKey && document.activeElement === first ) { e.preventDefault(); last.focus(); }
            else if ( !e.shiftKey && document.activeElement === last ) { e.preventDefault(); first.focus(); }
        }

        message( text, isError ) {
            this.msg.textContent = text || "";
            this.msg.hidden = !text;
            this.msg.classList.toggle( "is-error", !!isError );
        }

        open() {
            if ( this.isOpen || this.button.disabled ) { return; }
            if ( !this.root ) { this.build(); }
            this.isOpen = true;
            this.lastFocus = document.activeElement;
            this.root.hidden = false;
            document.documentElement.classList.add( "tx-ScanDlg-lock" );
            requestAnimationFrame( () => this.root.classList.add( "is-open" ) );
            this.closeBtn.focus();
            // a beep needs an audio context made while the user acts, so it is made now
            if ( this.feedback.includes( "beep" ) && !this.audio ) {
                try { this.audio = new ( window.AudioContext || window.webkitAudioContext )(); } catch ( e ) { this.audio = null; }
            }
            this.start();
        }

        close() {
            if ( !this.isOpen ) { return; }
            this.isOpen = false;
            this.stop();
            this.root.classList.remove( "is-open" );
            this.root.hidden = true;
            document.documentElement.classList.remove( "tx-ScanDlg-lock" );
            ( this.button || this.lastFocus ).focus();
        }

        async start( deviceId ) {
            this.stop();
            const imageHint = this.has( "image" ) ? " You can scan an image instead." : "";
            if ( !window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia ) {
                this.message( "The camera only works on secure (HTTPS) pages." + imageHint, true );
                return;
            }
            this.message( "Starting the camera..." );
            try {
                const video = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: this.o.camera === "front" ? "user" : "environment" } };
                video.width = { ideal: 1280 };
                video.height = { ideal: 720 };
                const stream = await navigator.mediaDevices.getUserMedia( { audio: false, video } );
                if ( !this.isOpen ) { stream.getTracks().forEach( t => t.stop() ); return; }
                this.stream = stream;
                this.track = stream.getVideoTracks()[ 0 ];
                this.video.srcObject = stream;
                await this.video.play();
                const settings = this.track.getSettings ? this.track.getSettings() : {};
                this.deviceId = settings.deviceId;
                this.mirrored = settings.facingMode === "user";
                this.stage.classList.toggle( "is-mirrored", this.mirrored );
                this.message( "Point the camera at a code." );

                const caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
                if ( this.torchBtn ) { this.torchBtn.hidden = !caps.torch; this.torchBtn.setAttribute( "aria-pressed", "false" ); }
                if ( this.switchBtn ) {
                    this.cameras = ( await navigator.mediaDevices.enumerateDevices() ).filter( d => d.kind === "videoinput" );
                    this.switchBtn.hidden = this.cameras.length < 2;
                }
                this.loop();
            } catch ( e ) {
                const name = e && e.name;
                this.message( ( name === "NotAllowedError" || name === "SecurityError" ? "Camera access is blocked. Allow it in the browser's site settings."
                    : name === "NotFoundError" || name === "OverconstrainedError" ? "No camera was found."
                    : name === "NotReadableError" ? "The camera is in use by another app."
                    : "The camera could not be started." ) + imageHint, true );
            }
        }

        stop() {
            clearTimeout( this.timer );
            if ( this.stream ) { this.stream.getTracks().forEach( t => t.stop() ); }
            this.stream = this.track = null;
            if ( this.video ) { this.video.srcObject = null; }
            this.torchOn = false;
        }

        // reads the video about eight times a second; each read waits for the previous one
        async loop() {
            if ( !this.isOpen || !this.stream ) { return; }
            if ( this.video.readyState >= 2 ) {
                try {
                    const codes = await this.detector.detect( this.video );
                    if ( codes.length && this.isOpen ) { this.found( codes[ 0 ], true ); }
                } catch ( e ) {
                    window.console.warn( "Barcode Scanner: reading failed", e );
                }
            }
            if ( this.isOpen && this.stream ) { this.timer = setTimeout( () => this.loop(), 120 ); }
        }

        async scanImage( file ) {
            this.message( "Reading the image..." );
            try {
                const bitmap = await createImageBitmap( file );
                const codes = await this.detector.detect( bitmap );
                if ( codes.length ) {
                    this.found( codes[ 0 ], false );
                } else {
                    this.message( "No code was found in this image. Try a sharper photo, closer to the code.", true );
                }
            } catch ( e ) {
                this.message( "This file could not be read as an image.", true );
            }
        }

        found( code, fromCamera ) {
            const value = code.rawValue, format = code.format, now = Date.now();
            if ( this.continuous && value === this.lastValue && now - this.lastTime < REPEAT_MS ) { return; }
            this.lastValue = value;
            this.lastTime = now;
            if ( fromCamera ) { this.outline( code.cornerPoints ); }
            this.signal();

            apex.item( this.name ).setValue( value );
            apex.event.trigger( this.input, "tx-barcode-scan", { value, format } );

            const label = LABELS[ format ] || format;
            if ( this.continuous && this.isOpen ) {
                const li = el( "li" );
                li.append( el( "strong", null, value ), el( "span", null, label ) );
                this.list.prepend( li );
                this.list.hidden = false;
                while ( this.list.children.length > 5 ) { this.list.lastElementChild.remove(); }
                this.message( "Scanned " + value + ". Point the camera at the next code." );
            } else {
                this.message( "Scanned " + value );
                setTimeout( () => this.close(), 450 );
            }
        }

        signal() {
            if ( this.feedback.includes( "vibrate" ) && navigator.vibrate ) { navigator.vibrate( 60 ); }
            if ( this.feedback.includes( "beep" ) && this.audio ) {
                try {
                    const ctx = this.audio, osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime;
                    osc.frequency.value = 1046;
                    gain.gain.setValueAtTime( 0.0001, t );
                    gain.gain.exponentialRampToValueAtTime( 0.12, t + 0.01 );
                    gain.gain.exponentialRampToValueAtTime( 0.0001, t + 0.12 );
                    osc.connect( gain ).connect( ctx.destination );
                    osc.start( t );
                    osc.stop( t + 0.13 );
                } catch ( e ) { /* no sound */ }
            }
        }

        // the found code's corners on the video, which is shown with object-fit: cover (and mirrored for front cameras)
        outline( points ) {
            if ( !points || !points.length ) { return; }
            const w = this.stage.clientWidth, h = this.stage.clientHeight, dpr = window.devicePixelRatio || 1,
                vw = this.video.videoWidth, vh = this.video.videoHeight;
            if ( !vw || !vh ) { return; }
            const s = Math.max( w / vw, h / vh ), ox = ( w - vw * s ) / 2, oy = ( h - vh * s ) / 2;
            this.hit.width = w * dpr;
            this.hit.height = h * dpr;
            const ctx = this.hit.getContext( "2d" );
            ctx.scale( dpr, dpr );
            ctx.beginPath();
            points.forEach( ( p, i ) => {
                let x = p.x * s + ox;
                const y = p.y * s + oy;
                if ( this.mirrored ) { x = w - x; }
                if ( i ) { ctx.lineTo( x, y ); } else { ctx.moveTo( x, y ); }
            } );
            ctx.closePath();
            ctx.lineWidth = 4;
            ctx.lineJoin = "round";
            ctx.strokeStyle = "#2fd36b";
            ctx.fillStyle = "rgba(47, 211, 107, .22)";
            ctx.fill();
            ctx.stroke();
            clearTimeout( this.hitTimer );
            this.hitTimer = setTimeout( () => ctx.clearRect( 0, 0, w, h ), 700 );
        }

        async toggleTorch() {
            if ( !this.track ) { return; }
            try {
                await this.track.applyConstraints( { advanced: [ { torch: !this.torchOn } ] } );
                this.torchOn = !this.torchOn;
                this.torchBtn.setAttribute( "aria-pressed", String( this.torchOn ) );
            } catch ( e ) {
                this.message( "The flashlight could not be turned on.", true );
            }
        }

        switchCamera() {
            if ( !this.cameras || this.cameras.length < 2 ) { return; }
            const i = this.cameras.findIndex( c => c.deviceId === this.deviceId ),
                next = this.cameras[ ( i + 1 ) % this.cameras.length ];
            this.start( next.deviceId );
        }

        setDisabled( disabled ) {
            this.input.disabled = disabled;
            this.button.disabled = disabled;
            if ( disabled ) { this.close(); }
        }
    }

    const scanners = {};
    ns.barcodeScanner = {
        init( itemName, options, initFn ) {
            if ( typeof initFn === "function" ) { options = initFn( options ) || options; }
            const s = new Scanner( itemName, options );
            scanners[ itemName ] = s;
            apex.item.create( itemName, {
                enable: () => s.setDisabled( false ),
                disable: () => s.setDisabled( true ),
                isDisabled: () => s.input.disabled
            } );
        },
        get: itemName => scanners[ itemName ]
    };
} )( apex.jQuery, apex );
