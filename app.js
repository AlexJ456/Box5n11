document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app-content');
    const canvas = document.getElementById('box-canvas');
    const ctx = canvas ? canvas.getContext('2d') : null;
    if (!app || !canvas || !ctx) {
        return;
    }
    const layoutHost = canvas.parentElement || document.querySelector('.container');
    const initialWidth = layoutHost ? layoutHost.clientWidth : canvas.clientWidth;
    const initialHeight = layoutHost ? layoutHost.clientHeight : canvas.clientHeight;

    const state = {
        isPlaying: false,
        count: 0,
        countdown: 4,
        totalTime: 0,
        soundEnabled: false,
        timeLimit: '',
        sessionComplete: false,
        timeLimitReached: false,
        phaseTime: 4,
        pulseStartTime: null,
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        viewportWidth: initialWidth,
        viewportHeight: initialHeight,
        prefersReducedMotion: false,
        hasStarted: false
    };

    let wakeLock = null;
    let audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const icons = {
        play: `<svg class="icon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
        pause: `<svg class="icon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`,
        volume2: `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
        volumeX: `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
        rotateCcw: `<svg class="icon" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`,
        clock: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`
    };

    function getInstruction(count) {
        switch (count) {
            case 0: return 'Inhale';
            case 1: return 'Hold';
            case 2: return 'Exhale';
            case 3: return 'Wait';
            default: return '';
        }
    }

    // Colors: Orange, Yellow, Blue, Green
    const phaseColors = ['#f97316', '#fbbf24', '#38bdf8', '#22c55e'];

    function hexToRgba(hex, alpha) {
        const normalized = hex.replace('#', '');
        const bigint = parseInt(normalized, 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function resizeCanvas() {
        const currentSizingElement = layoutHost || document.body;
        if (!currentSizingElement) return;

        const rect = currentSizingElement.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const pixelRatio = state.devicePixelRatio;

        state.viewportWidth = width;
        state.viewportHeight = height;

        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.width = Math.floor(width * pixelRatio);
        canvas.height = Math.floor(height * pixelRatio);

        if (ctx) {
            ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        }

        // Re-draw immediately if not playing (to update home screen dots)
        if (!state.isPlaying) {
            drawScene({ progress: 0, showTrail: false, phase: 0 });
        }
    }

    window.addEventListener('resize', resizeCanvas, { passive: true });

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // Improved Sound Engine: Soft Bell/Chime
    function playTone() {
        if (state.soundEnabled && audioContext) {
            try {
                const now = audioContext.currentTime;
                
                // Primary oscillator
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                
                // Harmonics for a richer sound
                const osc2 = audioContext.createOscillator();
                const gain2 = audioContext.createGain();

                osc.type = 'sine';
                osc2.type = 'sine';

                // Frequencies based on phases? Or constant?
                // Using a pleasant major chord tone or soft bell freq (approx 330Hz - E4)
                const freq = 329.63; 
                osc.frequency.setValueAtTime(freq, now);
                osc2.frequency.setValueAtTime(freq * 2, now); // Octave up

                // Envelope for Primary (Soft Attack, Long Decay)
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.3, now + 0.05); // Attack
                gain.gain.exponentialRampToValueAtTime(0.001, now + 2.0); // Decay

                // Envelope for Harmonic (Subtler)
                gain2.gain.setValueAtTime(0, now);
                gain2.gain.linearRampToValueAtTime(0.05, now + 0.05);
                gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

                osc.connect(gain);
                gain.connect(audioContext.destination);
                
                osc2.connect(gain2);
                gain2.connect(audioContext.destination);

                osc.start(now);
                osc2.start(now);
                
                osc.stop(now + 2.1);
                osc2.stop(now + 2.1);

            } catch (e) {
                console.error('Error playing tone:', e);
            }
        }
    }

    let interval;
    let animationFrameId;
    let lastStateUpdate;

    async function requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
            } catch (err) {
                console.error('Failed to acquire wake lock:', err);
            }
        }
    }

    function releaseWakeLock() {
        if (wakeLock !== null) {
            wakeLock.release().catch(console.error);
            wakeLock = null;
        }
    }

    function togglePlay() {
        state.isPlaying = !state.isPlaying;
        if (state.isPlaying) {
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume();
            }
            state.hasStarted = true;
            state.totalTime = 0;
            state.countdown = state.phaseTime;
            state.count = 0;
            state.sessionComplete = false;
            state.timeLimitReached = false;
            playTone();
            startInterval();
            animate();
            requestWakeLock();
        } else {
            clearInterval(interval);
            cancelAnimationFrame(animationFrameId);
            state.totalTime = 0;
            state.countdown = state.phaseTime;
            state.count = 0;
            state.hasStarted = false;
            // Force redraw to show home dots
            drawScene();
            releaseWakeLock();
        }
        render();
    }

    function resetToStart() {
        state.isPlaying = false;
        state.totalTime = 0;
        state.countdown = state.phaseTime;
        state.count = 0;
        state.sessionComplete = false;
        state.timeLimit = '';
        state.timeLimitReached = false;
        state.hasStarted = false;
        clearInterval(interval);
        cancelAnimationFrame(animationFrameId);
        drawScene();
        releaseWakeLock();
        render();
    }

    function startWithPreset(minutes) {
        state.timeLimit = minutes.toString();
        state.isPlaying = true;
        state.totalTime = 0;
        state.countdown = state.phaseTime;
        state.count = 0;
        state.sessionComplete = false;
        state.timeLimitReached = false;
        state.hasStarted = true;
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
        playTone();
        startInterval();
        animate();
        requestWakeLock();
        render();
    }

    function startInterval() {
        clearInterval(interval);
        lastStateUpdate = performance.now();
        interval = setInterval(() => {
            state.totalTime += 1;
            if (state.timeLimit && !state.timeLimitReached) {
                const timeLimitSeconds = parseInt(state.timeLimit) * 60;
                if (state.totalTime >= timeLimitSeconds) {
                    state.timeLimitReached = true;
                }
            }
            if (state.countdown <= 1) {
                state.count = (state.count + 1) % 4;
                state.countdown = state.phaseTime;
                playTone();
                if (state.count === 3 && state.timeLimitReached) {
                    state.sessionComplete = true;
                    state.isPlaying = false;
                    state.hasStarted = false;
                    clearInterval(interval);
                    cancelAnimationFrame(animationFrameId);
                    releaseWakeLock();
                }
            } else {
                state.countdown -= 1;
            }
            lastStateUpdate = performance.now();
            render();
        }, 1000);
    }

    // DRAWING LOGIC
    function drawScene({ progress = 0, phase = state.count, timestamp = performance.now() } = {}) {
        if (!ctx) return;

        const width = state.viewportWidth || canvas.width;
        const height = state.viewportHeight || canvas.height;
        const scale = state.devicePixelRatio || 1;
        
        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, width, height);

        // 1. HOME SCREEN / IDLE STATE: "Colored Dots Theme"
        if (!state.isPlaying && !state.sessionComplete) {
            const cx = width / 2;
            const cy = height / 2;
            // Determine a size that fits well but is big and prominent
            const size = Math.min(width, height) * 0.35; // Size of the imaginary box containing dots
            const dotRadius = size * 0.6; // Large dots

            // Positions for 2x2 grid centered on canvas
            // Inhale (TL), Hold (TR), Exhale (BR), Wait (BL) - Circular logic
            const offset = size * 0.6;
            
            const positions = [
                { x: cx - offset/2, y: cy - offset/2, color: phaseColors[0] }, // TL
                { x: cx + offset/2, y: cy - offset/2, color: phaseColors[1] }, // TR
                { x: cx + offset/2, y: cy + offset/2, color: phaseColors[2] }, // BR
                { x: cx - offset/2, y: cy + offset/2, color: phaseColors[3] }  // BL
            ];

            positions.forEach(pos => {
                // Glow
                const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, dotRadius * 2.5);
                grad.addColorStop(0, hexToRgba(pos.color, 0.4));
                grad.addColorStop(0.5, hexToRgba(pos.color, 0.1));
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, dotRadius * 2.5, 0, Math.PI * 2);
                ctx.fill();

                // Core Dot
                ctx.fillStyle = pos.color;
                ctx.globalAlpha = 0.8;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, dotRadius * 0.4, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1.0;
            });
            
            ctx.restore();
            return;
        }

        // 2. EXERCISE STATE
        // Request: "Remove the countdown and the box animation."
        // We will just clear the canvas (done above) and return. 
        // The HTML text and phase dots will handle the UI.
        
        ctx.restore();
    }

    function updateCanvasVisibility() {
        // We always want the canvas visible now because it holds the home theme
        // or clears specifically for exercise
        canvas.classList.add('is-visible');
    }

    function animate() {
        if (!state.isPlaying) return;
        const now = performance.now();
        const elapsed = (now - lastStateUpdate) / 1000;
        const effectiveCountdown = state.countdown - elapsed;
        let progress = (state.phaseTime - effectiveCountdown) / state.phaseTime;
        progress = Math.max(0, Math.min(1, progress));

        drawScene({ progress, timestamp: now });
        animationFrameId = requestAnimationFrame(animate);
    }

    function render() {
        let html = `
            <h1>Box Breathing</h1>
        `;
        if (state.isPlaying) {
            // Note: removed countdown number div per request
            html += `
                <div class="timer">Total: ${formatTime(state.totalTime)}</div>
                <div class="instruction">${getInstruction(state.count)}</div>
            `;
            const phases = ['Inhale', 'Hold', 'Exhale', 'Wait'];
            html += `<div class="phase-tracker">`;
            phases.forEach((label, index) => {
                const phaseColor = phaseColors[index] || '#fde68a';
                html += `
                    <div class="phase-item ${index === state.count ? 'active' : ''}" style="--phase-color: ${phaseColor}">
                        <span class="phase-dot"></span>
                        <span class="phase-label">${label}</span>
                    </div>
                `;
            });
            html += `</div>`;
        }
        
        if (state.timeLimitReached && !state.sessionComplete) {
            const limitMessage = state.isPlaying ? 'Finishing cycle…' : 'Time limit reached';
            html += `<div class="limit-warning" style="color:#f97316; margin-bottom:1rem;">${limitMessage}</div>`;
        }
        
        if (!state.isPlaying && !state.sessionComplete) {
            html += `
                <div class="settings">
                    <div class="form-group">
                        <label class="switch">
                            <input type="checkbox" id="sound-toggle" ${state.soundEnabled ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                        <label for="sound-toggle" style="cursor:pointer; color: #fde68a;">
                            Sound ${state.soundEnabled ? 'On' : 'Off'}
                        </label>
                    </div>
                    
                    <div class="slider-container">
                         <label for="phase-time-slider" style="display:flex; justify-content:space-between; color:#fde68a;">
                            <span>Phase Duration</span>
                            <span style="color:#f59e0b; font-weight:bold;"><span id="phase-time-value">${state.phaseTime}</span>s</span>
                        </label>
                        <input type="range" min="3" max="8" step="1" value="${state.phaseTime}" id="phase-time-slider">
                    </div>

                    <div class="form-group">
                        <input
                            type="number"
                            inputmode="numeric"
                            placeholder="Set timer (minutes)"
                            value="${state.timeLimit}"
                            id="time-limit"
                            step="1"
                            min="0"
                        >
                    </div>
                    
                     <div class="shortcut-buttons">
                        <button id="preset-2min" class="preset-button">2m</button>
                        <button id="preset-5min" class="preset-button">5m</button>
                        <button id="preset-10min" class="preset-button">10m</button>
                    </div>
                </div>
            `;
        }
        
        if (state.sessionComplete) {
            html += `<div class="complete" style="font-size:2rem; color:#4ade80; margin-bottom:2rem;">Session Complete</div>`;
        }
        
        if (!state.sessionComplete) {
            html += `
                <button id="toggle-play">
                    ${state.isPlaying ? icons.pause : icons.play}
                    ${state.isPlaying ? 'Pause' : 'Start Exercise'}
                </button>
            `;
        }
        
        if (state.sessionComplete) {
            html += `
                <button id="reset">
                    ${icons.rotateCcw}
                    Back to Start
                </button>
            `;
        }

        app.innerHTML = html;

        updateCanvasVisibility();

        // Attach listeners
        if (document.getElementById('toggle-play')) {
            document.getElementById('toggle-play').addEventListener('click', togglePlay);
        }
        if (document.getElementById('reset')) {
            document.getElementById('reset').addEventListener('click', resetToStart);
        }
        
        if (!state.isPlaying && !state.sessionComplete) {
            document.getElementById('sound-toggle').addEventListener('change', () => {
                state.soundEnabled = !state.soundEnabled;
                render();
            });
            document.getElementById('time-limit').addEventListener('input', (e) => {
                state.timeLimit = e.target.value.replace(/[^0-9]/g, '');
            });
            const slider = document.getElementById('phase-time-slider');
            if(slider) {
                slider.addEventListener('input', function() {
                    state.phaseTime = parseInt(this.value);
                    const label = document.getElementById('phase-time-value');
                    if(label) label.textContent = state.phaseTime;
                });
            }
            document.getElementById('preset-2min').addEventListener('click', () => startWithPreset(2));
            document.getElementById('preset-5min').addEventListener('click', () => startWithPreset(5));
            document.getElementById('preset-10min').addEventListener('click', () => startWithPreset(10));
        }

        // Draw initial home scene
        if (!state.isPlaying) {
            drawScene();
        }
    }

    render();
    resizeCanvas();
});
