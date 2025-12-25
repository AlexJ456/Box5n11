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
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 1.75),
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

    // Orange, Yellow, Blue, Green
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
        if (!currentSizingElement) {
            return;
        }

        const rect = currentSizingElement.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);

        state.viewportWidth = width;
        state.viewportHeight = height;
        state.devicePixelRatio = pixelRatio;

        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.width = Math.floor(width * pixelRatio);
        canvas.height = Math.floor(height * pixelRatio);

        if (ctx) {
            ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        }

        if (!state.isPlaying) {
            drawScene({ progress: state.sessionComplete ? 1 : 0, phase: state.count });
        }
    }

    window.addEventListener('resize', resizeCanvas, { passive: true });

    function updateMotionPreference(event) {
        state.prefersReducedMotion = event.matches;
        if (!state.isPlaying) {
            drawScene({ progress: state.sessionComplete ? 1 : 0, phase: state.count });
        }
    }

    const motionQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    if (motionQuery) {
        state.prefersReducedMotion = motionQuery.matches;
        if (typeof motionQuery.addEventListener === 'function') {
            motionQuery.addEventListener('change', updateMotionPreference);
        } else if (typeof motionQuery.addListener === 'function') {
            motionQuery.addListener(updateMotionPreference);
        }
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    function playTone() {
        if (state.soundEnabled && audioContext) {
            try {
                const now = audioContext.currentTime;
                
                // Create Oscillator (Fundamental)
                const oscillator = audioContext.createOscillator();
                oscillator.type = 'sine';
                // Use a soft pentatonic note or just a pleasant sine (440Hz A4 or 523Hz C5)
                // Let's use different pitches for phases for better feedback? 
                // Or stick to a consistent calm chime. Let's do consistent calm chime (C5).
                oscillator.frequency.setValueAtTime(523.25, now);

                // Create Gain (Volume Envelope)
                const gainNode = audioContext.createGain();
                
                // Connect
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                // Envelope logic for a "bell" sound
                gainNode.gain.setValueAtTime(0, now);
                // Attack (quick fade in)
                gainNode.gain.linearRampToValueAtTime(0.3, now + 0.05); 
                // Decay/Release (long tail)
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

                oscillator.start(now);
                oscillator.stop(now + 1.5);
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
                console.log('Wake lock is active');
            } catch (err) {
                console.error('Failed to acquire wake lock:', err);
            }
        } else {
            console.log('Wake Lock API not supported');
        }
    }

    function releaseWakeLock() {
        if (wakeLock !== null) {
            wakeLock.release()
                .then(() => {
                    wakeLock = null;
                    console.log('Wake lock released');
                })
                .catch(err => {
                    console.error('Failed to release wake lock:', err);
                });
        }
    }

    function togglePlay() {
        state.isPlaying = !state.isPlaying;
        if (state.isPlaying) {
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume().then(() => {
                    console.log('AudioContext resumed');
                });
            }
            state.hasStarted = true;
            state.totalTime = 0;
            state.countdown = state.phaseTime;
            state.count = 0;
            state.sessionComplete = false;
            state.timeLimitReached = false;
            state.pulseStartTime = performance.now();
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
            state.sessionComplete = false;
            state.timeLimitReached = false;
            state.hasStarted = false;
            drawScene({ progress: 0, phase: state.count });
            state.pulseStartTime = null;
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
        state.pulseStartTime = null;
        state.hasStarted = false;
        clearInterval(interval);
        cancelAnimationFrame(animationFrameId);
        drawScene({ progress: 0, phase: state.count });
        releaseWakeLock();
        render();
    }

    function toggleSound() {
        state.soundEnabled = !state.soundEnabled;
        render();
    }

    function handleTimeLimitChange(e) {
        state.timeLimit = e.target.value.replace(/[^0-9]/g, '');
    }

    function startWithPreset(minutes) {
        state.timeLimit = minutes.toString();
        state.isPlaying = true;
        state.totalTime = 0;
        state.countdown = state.phaseTime;
        state.count = 0;
        state.sessionComplete = false;
        state.timeLimitReached = false;
        state.pulseStartTime = performance.now();
        state.hasStarted = true;
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('AudioContext resumed');
            });
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
            if (state.countdown === 1) {
                state.count = (state.count + 1) % 4;
                state.pulseStartTime = performance.now();
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

    function drawScene({ progress = 0, phase = state.count, timestamp = performance.now() } = {}) {
        if (!ctx) return;

        const width = state.viewportWidth || canvas.clientWidth || canvas.width;
        const height = state.viewportHeight || canvas.clientHeight || canvas.height;
        if (!width || !height) return;

        const scale = state.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, 0, 0);

        ctx.clearRect(0, 0, width, height);

        if (!state.hasStarted && !state.sessionComplete) {
            ctx.restore();
            return;
        }

        const easedProgress = 0.5 - (Math.cos(Math.PI * Math.max(0, Math.min(1, progress))) / 2);
        
        // Define Grid
        const centerX = width / 2;
        // Shift vertical center up slightly to account for the "Instruction" text at the bottom
        const centerY = height / 2 - 20; 
        
        // Size of the square grid
        const boxSize = Math.min(width, height) * 0.55; 
        const halfBox = boxSize / 2;
        
        // Max radius for a dot
        const baseRadius = boxSize * 0.18; 
        
        // Positions: TopLeft(0), TopRight(1), BottomRight(2), BottomLeft(3)
        // Matches phases: Inhale(0), Hold(1), Exhale(2), Wait(3)
        const positions = [
            { x: centerX - halfBox, y: centerY - halfBox }, // Top Left
            { x: centerX + halfBox, y: centerY - halfBox }, // Top Right
            { x: centerX + halfBox, y: centerY + halfBox }, // Bottom Right
            { x: centerX - halfBox, y: centerY + halfBox }  // Bottom Left
        ];

        positions.forEach((pos, index) => {
            let radius = baseRadius;
            let opacity = 0.15; // Dim inactive dots
            
            const isCurrentPhase = index === phase;
            const color = phaseColors[index];

            if (isCurrentPhase) {
                opacity = 1;
                
                // Animation Logic based on Phase
                if (phase === 0) {
                    // Inhale: Grow
                    radius = baseRadius * 0.5 + (baseRadius * 0.8 * easedProgress);
                } else if (phase === 1) {
                    // Hold: Pulse slightly (Full size)
                    const pulse = Math.sin(timestamp / 200) * 0.05;
                    radius = baseRadius * 1.3 + (baseRadius * pulse);
                } else if (phase === 2) {
                    // Exhale: Shrink
                    radius = baseRadius * 1.3 - (baseRadius * 0.8 * easedProgress);
                } else if (phase === 3) {
                    // Wait: Pulse slightly (Small size)
                    const pulse = Math.sin(timestamp / 300) * 0.05;
                    radius = baseRadius * 0.5 + (baseRadius * pulse);
                }
            } else {
                // Non-active dots stay small
                radius = baseRadius * 0.4;
            }

            // Draw Glow
            if (isCurrentPhase) {
                const glow = ctx.createRadialGradient(pos.x, pos.y, radius * 0.5, pos.x, pos.y, radius * 2);
                glow.addColorStop(0, hexToRgba(color, 0.4));
                glow.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, radius * 2, 0, Math.PI * 2);
                ctx.fill();
            }

            // Draw Dot
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = hexToRgba(color, opacity);
            ctx.fill();

            // Optional: Draw stroke for inactive dots to keep structure visible
            if (!isCurrentPhase) {
                ctx.strokeStyle = hexToRgba(color, 0.3);
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        });

        ctx.restore();
    }

    function updateCanvasVisibility() {
        const shouldShow = state.isPlaying || state.sessionComplete;
        canvas.classList.toggle('is-visible', shouldShow);
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
        let html = `<h1>Box Breathing</h1>`;
        
        if (state.isPlaying) {
            html += `
                <div class="timer">Total Time: ${formatTime(state.totalTime)}</div>
                
                <div style="flex-grow: 1;"></div> 

                <div class="instruction active-phase-text" style="color: ${phaseColors[state.count]}">
                    ${getInstruction(state.count)}
                </div>
                
                <div style="height: 10vh;"></div>
            `;
            // NOTE: Removed Countdown number and small Phase Tracker dots
        }
        
        if (state.timeLimitReached && !state.sessionComplete) {
            const limitMessage = state.isPlaying ? 'Finishing current cycle…' : 'Time limit reached';
            html += `<div class="limit-warning">${limitMessage}</div>`;
        }
        
        if (!state.isPlaying && !state.sessionComplete) {
            html += `
                <div class="settings">
                    <div class="form-group">
                        <label class="switch">
                            <input type="checkbox" id="sound-toggle" ${state.soundEnabled ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                        <label for="sound-toggle">
                            ${state.soundEnabled ? icons.volume2 : icons.volumeX}
                            Sound ${state.soundEnabled ? 'On' : 'Off'}
                        </label>
                    </div>
                    <div class="form-group">
                        <input
                            type="number"
                            inputmode="numeric"
                            placeholder="Time limit (minutes)"
                            value="${state.timeLimit}"
                            id="time-limit"
                            step="1"
                            min="0"
                        >
                        <label for="time-limit">Minutes (optional)</label>
                    </div>
                </div>
                <div class="prompt">Press start to begin</div>
            `;
        }
        
        if (state.sessionComplete) {
            html += `<div class="complete">Complete!</div>`;
        }
        
        if (!state.sessionComplete) {
            html += `
                <button id="toggle-play" class="modern-btn main-btn">
                    ${state.isPlaying ? icons.pause : icons.play}
                    ${state.isPlaying ? 'Pause' : 'Start'}
                </button>
            `;
        }
        
        if (!state.isPlaying && !state.sessionComplete) {
            html += `
                <div class="slider-container">
                    <label for="phase-time-slider">Phase Time (seconds): <span id="phase-time-value">${state.phaseTime}</span></label>
                    <input type="range" min="3" max="6" step="1" value="${state.phaseTime}" id="phase-time-slider">
                </div>
            `;
        }
        
        if (state.sessionComplete) {
            html += `
                <button id="reset" class="modern-btn sub-btn">
                    ${icons.rotateCcw}
                    Back to Start
                </button>
            `;
        }
        
        if (!state.isPlaying && !state.sessionComplete) {
            html += `
                <div class="shortcut-buttons">
                    <button id="preset-2min" class="preset-button modern-btn">
                        ${icons.clock} 2 min
                    </button>
                    <button id="preset-5min" class="preset-button modern-btn">
                        ${icons.clock} 5 min
                    </button>
                    <button id="preset-10min" class="preset-button modern-btn">
                        ${icons.clock} 10 min
                    </button>
                </div>
            `;
        }
        
        app.innerHTML = html;

        updateCanvasVisibility();

        if (!state.sessionComplete) {
            const btn = document.getElementById('toggle-play');
            if(btn) btn.addEventListener('click', togglePlay);
        }
        if (state.sessionComplete) {
            document.getElementById('reset').addEventListener('click', resetToStart);
        }
        if (!state.isPlaying && !state.sessionComplete) {
            document.getElementById('sound-toggle').addEventListener('change', toggleSound);
            const timeLimitInput = document.getElementById('time-limit');
            timeLimitInput.addEventListener('input', handleTimeLimitChange);
            const phaseTimeSlider = document.getElementById('phase-time-slider');
            phaseTimeSlider.addEventListener('input', function() {
                state.phaseTime = parseInt(this.value);
                document.getElementById('phase-time-value').textContent = state.phaseTime;
            });
            document.getElementById('preset-2min').addEventListener('click', () => startWithPreset(2));
            document.getElementById('preset-5min').addEventListener('click', () => startWithPreset(5));
            document.getElementById('preset-10min').addEventListener('click', () => startWithPreset(10));
        }
        if (!state.isPlaying) {
            drawScene({ progress: state.sessionComplete ? 1 : 0, phase: state.count });
        }
    }

    render();
    resizeCanvas();
});
