const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

const ui = {
  playToggle: document.getElementById('playToggle'),
  resetBtn: document.getElementById('resetBtn'),
  savePatternBtn: document.getElementById('savePatternBtn'),
  screenshotBtn: document.getElementById('screenshotBtn'),
  modeSelect: document.getElementById('modeSelect'),
  shapeSelect: document.getElementById('shapeSelect'),
  plateSize: document.getElementById('plateSize'),
  freqSlider: document.getElementById('freqSlider'),
  freqInput: document.getElementById('freqInput'),
  ampSlider: document.getElementById('ampSlider'),
  lockNote: document.getElementById('lockNote'),
  autoSweep: document.getElementById('autoSweep'),
  micToggle: document.getElementById('micToggle'),
  cinematicMode: document.getElementById('cinematicMode'),
  presetRow: document.getElementById('presetRow'),
  metrics: document.getElementById('metrics'),
  analysis: document.getElementById('analysis'),
  discoveries: document.getElementById('discoveries'),
  archive: document.getElementById('archive'),
  resonanceBanner: document.getElementById('resonanceBanner'),
};

const state = {
  mode: 'chladni',
  shape: 'square',
  plateSize: 0.92,
  frequency: 220,
  targetFrequency: 220,
  amplitude: 0.18,
  playing: false,
  autoSweepPhase: 0,
  particles: [],
  unlocked: new Set(['First Stable Mode']),
  archive: [],
  resonanceStrength: 0,
  chaos: 1,
  lockPulse: 0,
  lastLockMs: 0,
};

const SPECTRAL_LINES = [
  { element: 'Hydrogen H-alpha', hz: 4.57e14 },
  { element: 'Hydrogen H-beta', hz: 6.16e14 },
  { element: 'Sodium D-line', hz: 5.09e14 },
  { element: 'Oxygen green auroral', hz: 5.66e14 },
  { element: 'Calcium K', hz: 7.61e14 },
];

const PRESETS = [110, 128, 144, 180, 220, 256, 288, 320, 432, 512, 640, 880];
const RESONANCE_MAP = [
  { f: 110, w: [1, 2] }, { f: 144, w: [2, 3] }, { f: 180, w: [3, 4] },
  { f: 220, w: [4, 5] }, { f: 256, w: [5, 5] }, { f: 288, w: [6, 5] },
  { f: 320, w: [6, 6] }, { f: 384, w: [7, 6] }, { f: 432, w: [7, 7] },
  { f: 512, w: [8, 7] }, { f: 640, w: [9, 8] }, { f: 880, w: [11, 10] },
];

let audioCtx;
let osc;
let gain;
let micNode;
let analyser;
let micStream;

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  osc = audioCtx.createOscillator();
  gain = audioCtx.createGain();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  osc.type = 'sine';
  osc.connect(gain);
  gain.connect(analyser);
  analyser.connect(audioCtx.destination);
  gain.gain.value = 0;
  osc.start();
}

function setPlaying(on) {
  ensureAudio();
  state.playing = on;
  ui.playToggle.textContent = on ? '■ Stop Tone' : '▶ Play Tone';
  gain.gain.setTargetAtTime(on ? state.amplitude : 0, audioCtx.currentTime, 0.03);
}

function frequencyToNote(freq, a4 = 440) {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midi = Math.round(12 * Math.log2(freq / a4) + 69);
  const note = notes[(midi + 1200) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const noteFreq = a4 * 2 ** ((midi - 69) / 12);
  const cents = 1200 * Math.log2(freq / noteFreq);
  return { note: `${note}${octave}`, cents, noteFreq };
}

function classifySpectrum(freq) {
  const c = 299_792_458;
  const wavelength = c / freq;
  if (freq < 20) return ['Sub-audio', wavelength];
  if (freq < 20_000) return ['Audio', wavelength];
  if (freq < 3e9) return ['Radio', wavelength];
  if (freq < 3e11) return ['Microwave', wavelength];
  if (freq < 4e14) return ['Infrared', wavelength];
  if (freq < 7.5e14) return ['Visible light', wavelength];
  if (freq < 3e16) return ['Ultraviolet', wavelength];
  if (freq < 3e19) return ['X-ray', wavelength];
  return ['Gamma', wavelength];
}

function nearestLine(freq) {
  return SPECTRAL_LINES.reduce((best, line) => {
    const err = Math.abs(line.hz - freq);
    return err < best.err ? { ...line, err } : best;
  }, { element: 'None', hz: 0, err: Infinity });
}

function resonanceModel(freq) {
  const nearest = RESONANCE_MAP.reduce((best, mode) => {
    const d = Math.abs(mode.f - freq);
    return d < best.d ? { ...mode, d } : best;
  }, { f: 0, w: [1, 1], d: Infinity });
  const strength = Math.max(0, 1 - nearest.d / 26);
  const stability = Math.max(0, 1 - nearest.d / 18);
  const symmetry = Math.min(1, (nearest.w[0] + nearest.w[1]) / 20);
  const complexity = Math.min(1, (nearest.w[0] * nearest.w[1]) / 120);
  const chaos = 1 - stability * 0.85;
  return { nearest, strength, stability, symmetry, complexity, chaos };
}

function initializeParticles(count = 2600) {
  state.particles = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: 0,
    vy: 0,
  }));
}

function drawBackdrop(t) {
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#0a1224');
  g.addColorStop(1, '#03060f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 40; i += 1) {
    const x = (i * 129.7 + t * 0.04) % canvas.width;
    const y = (i * 89.3 + t * 0.03) % canvas.height;
    ctx.fillStyle = 'rgba(155,190,255,0.05)';
    ctx.beginPath();
    ctx.arc(x, y, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function updateTelemetry(model) {
  const m = [
    ['Resonance Strength', model.strength],
    ['Stability', model.stability],
    ['Symmetry', model.symmetry],
    ['Complexity', model.complexity],
    ['Chaos / Order', 1 - model.chaos],
  ];
  ui.metrics.innerHTML = m.map(([name, v]) => `
    <div>${name}: ${(v * 100).toFixed(0)}%
      <div class="meter"><span style="width:${(v * 100).toFixed(0)}%"></span></div>
    </div>
  `).join('');

  const note440 = frequencyToNote(state.frequency, 440);
  const note432 = frequencyToNote(state.frequency, 432);
  const [band, wavelength] = classifySpectrum(state.frequency);
  const nearest = nearestLine(state.frequency);
  const harmonicRatio = `${model.nearest.w[0]}:${model.nearest.w[1]}`;

  ui.analysis.innerHTML = `
    <div><strong>Nearest note (A4=440):</strong> ${note440.note} (${note440.cents.toFixed(1)} cents)</div>
    <div><strong>Alt note (A4=432):</strong> ${note432.note} (${note432.cents.toFixed(1)} cents)</div>
    <div><strong>Spectral band:</strong> ${band}</div>
    <div><strong>Wavelength:</strong> ${formatDistance(wavelength)}</div>
    <div><strong>Atomic match:</strong> ${nearest.element} (Δ ${(nearest.err / nearest.hz * 100 || 0).toFixed(4)}%)</div>
    <div><strong>Harmonic relation:</strong> ${harmonicRatio}</div>
  `;
}

function formatDistance(m) {
  if (m > 1) return `${m.toFixed(2)} m`;
  if (m > 1e-3) return `${(m * 1e3).toFixed(2)} mm`;
  if (m > 1e-6) return `${(m * 1e6).toFixed(2)} µm`;
  if (m > 1e-9) return `${(m * 1e9).toFixed(2)} nm`;
  return `${(m * 1e12).toFixed(2)} pm`;
}

function maybeUnlock(model) {
  const unlocked = [];
  if (model.stability > 0.85) unlocked.push('First Stable Mode');
  if (model.strength > 0.95) unlocked.push('Perfect Nodal Lock');
  if (Math.abs(state.frequency - 432) < 0.8) unlocked.push('432 Alignment');
  if (classifySpectrum(state.frequency)[0] === 'Visible light') unlocked.push('Visible Light Frequency Entered');
  if (nearestLine(state.frequency).element.includes('Hydrogen')) unlocked.push('Hydrogen Match Detected');
  if (state.mode === 'bubble' && model.stability > 0.7) unlocked.push('Bubble Harmonic Unlocked');

  let changed = false;
  for (const item of unlocked) {
    if (!state.unlocked.has(item)) {
      state.unlocked.add(item);
      changed = true;
    }
  }
  if (changed) {
    ui.discoveries.innerHTML = [...state.unlocked].map((d) => `<li>${d}</li>`).join('');
  }
}

function resonanceFieldAt(x, y, time, mode) {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const dx = (x - centerX) / (canvas.width * state.plateSize * 0.5);
  const dy = (y - centerY) / (canvas.height * state.plateSize * 0.5);
  const r = Math.sqrt(dx * dx + dy * dy) + 1e-6;
  const angle = Math.atan2(dy, dx);
  const [m, n] = mode.nearest.w;

  if (state.shape === 'circle') {
    const wave = Math.sin(m * angle + time * 0.0005) * Math.cos(n * Math.PI * r);
    return Math.abs(wave);
  }
  const sx = Math.sin(m * Math.PI * dx);
  const sy = Math.sin(n * Math.PI * dy);
  return Math.abs(sx * sy);
}

function drawChladni(time, model) {
  const plateRadius = Math.min(canvas.width, canvas.height) * 0.42 * state.plateSize;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.strokeStyle = 'rgba(135,178,255,0.2)';
  ctx.lineWidth = 2;
  if (state.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(0, 0, plateRadius, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeRect(-plateRadius, -plateRadius, plateRadius * 2, plateRadius * 2);
  }
  ctx.restore();

  for (const p of state.particles) {
    const node = resonanceFieldAt(p.x, p.y, time, model);
    const jitter = (0.4 + state.chaos * 3.2) * (1 + state.amplitude * 4);
    const away = (0.5 - node) * model.strength * 2;
    p.vx += (Math.random() - 0.5) * jitter + away * 0.12;
    p.vy += (Math.random() - 0.5) * jitter - away * 0.12;
    p.vx *= 0.93;
    p.vy *= 0.93;
    p.x = (p.x + p.vx + canvas.width) % canvas.width;
    p.y = (p.y + p.vy + canvas.height) % canvas.height;

    const lum = Math.max(0.18, 1 - node * 1.6);
    ctx.fillStyle = `rgba(245, 245, 235, ${lum})`;
    ctx.fillRect(p.x, p.y, 1.5, 1.5);
  }
}

function drawLiquid(time, model) {
  const step = 10;
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const field = resonanceFieldAt(x, y, time, model);
      const ripple = Math.sin((x + y) * 0.03 - time * 0.003 + state.frequency * 0.004);
      const v = 0.55 * field + 0.45 * (ripple * 0.5 + 0.5);
      const c = Math.floor(40 + v * 180);
      ctx.fillStyle = `rgba(${40 + c * 0.2},${70 + c * 0.5},${120 + c},0.8)`;
      ctx.fillRect(x, y, step + 1, step + 1);
    }
  }
}

function drawOobleck(time, model) {
  for (let i = 0; i < 180; i += 1) {
    const x = (i * 37.7 + time * 0.05) % canvas.width;
    const y = ((i * 97.7) + Math.sin(time * 0.001 + i) * 120 + canvas.height) % canvas.height;
    const field = resonanceFieldAt(x, y, time, model);
    const s = 4 + field * 26 * (1 + model.strength);
    ctx.fillStyle = `hsla(${260 + field * 140}, 80%, ${38 + field * 42}%, 0.35)`;
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * (0.5 + field), 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBubble(time, model) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  for (let i = 0; i < 56; i += 1) {
    const phi = (i / 56) * Math.PI * 2 + time * 0.0003;
    const rad = 120 + Math.sin(phi * model.nearest.w[0]) * 20 * model.strength;
    const x = cx + Math.cos(phi) * rad;
    const y = cy + Math.sin(phi) * rad;
    const hue = (time * 0.03 + i * 12) % 360;
    ctx.strokeStyle = `hsla(${hue},90%,65%,0.45)`;
    ctx.beginPath();
    ctx.arc(x, y, 22 + model.stability * 16, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawField(time, model) {
  for (let i = 0; i < 1200; i += 1) {
    const a = i * 0.12 + time * 0.0005;
    const radius = (i % 120) * 3.9 + Math.sin(i + time * 0.001) * 8;
    const x = canvas.width / 2 + Math.cos(a) * radius;
    const y = canvas.height / 2 + Math.sin(a * 1.2) * radius * 0.45;
    const field = resonanceFieldAt(x, y, time, model);
    const alpha = 0.12 + field * 0.6;
    ctx.fillStyle = `rgba(${80 + field * 180}, ${100 + field * 120}, 255, ${alpha})`;
    ctx.fillRect(x, y, 2, 2);
  }
}

function render(time) {
  state.frequency += (state.targetFrequency - state.frequency) * 0.12;
  if (state.autoSweepPhase !== 0 || ui.autoSweep.checked) {
    state.autoSweepPhase += 0.015;
    state.targetFrequency = 180 + (Math.sin(state.autoSweepPhase) * 0.5 + 0.5) * 760;
    ui.freqSlider.value = state.targetFrequency.toFixed(1);
    ui.freqInput.value = state.targetFrequency.toFixed(1);
  }

  if (ui.lockNote.checked) {
    state.targetFrequency = frequencyToNote(state.targetFrequency).noteFreq;
  }

  if (audioCtx) {
    osc.frequency.setTargetAtTime(state.frequency, audioCtx.currentTime, 0.02);
    gain.gain.setTargetAtTime(state.playing ? state.amplitude : 0, audioCtx.currentTime, 0.03);
  }

  const model = resonanceModel(state.frequency);
  state.resonanceStrength = model.strength;
  state.chaos += (model.chaos - state.chaos) * 0.09;

  drawBackdrop(time);
  if (state.mode === 'chladni') drawChladni(time, model);
  else if (state.mode === 'liquid') drawLiquid(time, model);
  else if (state.mode === 'oobleck') drawOobleck(time, model);
  else if (state.mode === 'bubble') drawBubble(time, model);
  else drawField(time, model);

  updateTelemetry(model);
  maybeUnlock(model);

  const now = performance.now();
  const lock = model.stability > 0.88;
  if (lock && now - state.lastLockMs > 1300) {
    state.lockPulse = 1;
    state.lastLockMs = now;
  }
  state.lockPulse *= 0.93;
  ui.resonanceBanner.classList.toggle('show', state.lockPulse > 0.2);

  requestAnimationFrame(render);
}

function saveArchiveCard(customName) {
  const item = {
    mode: state.mode,
    freq: Number(state.frequency.toFixed(2)),
    note: frequencyToNote(state.frequency).note,
    createdAt: new Date().toISOString(),
    name: customName || `${state.mode} @ ${state.frequency.toFixed(1)}Hz`,
    image: canvas.toDataURL('image/png'),
  };
  state.archive.unshift(item);
  state.archive = state.archive.slice(0, 12);
  localStorage.setItem('cymaticsArchive', JSON.stringify(state.archive));
  renderArchive();
}

function renderArchive() {
  const tpl = document.getElementById('archiveCardTemplate');
  ui.archive.innerHTML = '';
  for (const entry of state.archive) {
    const node = tpl.content.cloneNode(true);
    node.querySelector('img').src = entry.image;
    node.querySelector('.archive-meta').textContent = `${entry.name} · ${entry.note}`;
    ui.archive.appendChild(node);
  }
}

async function toggleMicInput(on) {
  ensureAudio();
  if (on) {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micNode = audioCtx.createMediaStreamSource(micStream);
    micNode.connect(analyser);
  } else if (micStream) {
    for (const track of micStream.getTracks()) track.stop();
    micNode?.disconnect();
  }
}

function setupPresetButtons() {
  ui.presetRow.innerHTML = '';
  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.textContent = `${p}Hz`;
    b.addEventListener('click', () => {
      state.targetFrequency = p;
      ui.freqSlider.value = String(p);
      ui.freqInput.value = String(p);
    });
    ui.presetRow.appendChild(b);
  });
}

function bindEvents() {
  ui.playToggle.addEventListener('click', () => setPlaying(!state.playing));
  ui.resetBtn.addEventListener('click', () => initializeParticles());
  ui.modeSelect.addEventListener('change', (e) => { state.mode = e.target.value; });
  ui.shapeSelect.addEventListener('change', (e) => { state.shape = e.target.value; });
  ui.plateSize.addEventListener('input', (e) => { state.plateSize = Number(e.target.value); });

  ui.freqSlider.addEventListener('input', (e) => {
    state.targetFrequency = Number(e.target.value);
    ui.freqInput.value = e.target.value;
  });
  ui.freqInput.addEventListener('change', (e) => {
    const val = Math.max(0.1, Number(e.target.value));
    state.targetFrequency = val;
    ui.freqSlider.value = String(Math.min(1600, Math.max(20, val)));
  });
  ui.ampSlider.addEventListener('input', (e) => { state.amplitude = Number(e.target.value); });

  ui.savePatternBtn.addEventListener('click', () => {
    const name = prompt('Name this resonance artifact:', `${state.mode}-${state.frequency.toFixed(1)}Hz`);
    if (name) saveArchiveCard(name);
  });
  ui.screenshotBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `cymatics-${Date.now()}.png`;
    link.click();
  });

  ui.micToggle.addEventListener('change', async (e) => {
    try {
      await toggleMicInput(e.target.checked);
    } catch {
      e.target.checked = false;
      alert('Microphone access is unavailable in this environment.');
    }
  });

  ui.cinematicMode.addEventListener('change', (e) => {
    document.body.classList.toggle('cinematic', e.target.checked);
  });
}

function bootstrap() {
  setupPresetButtons();
  bindEvents();
  initializeParticles();
  const archive = localStorage.getItem('cymaticsArchive');
  if (archive) {
    try { state.archive = JSON.parse(archive); } catch { state.archive = []; }
  }
  renderArchive();
  ui.discoveries.innerHTML = [...state.unlocked].map((d) => `<li>${d}</li>`).join('');
  requestAnimationFrame(render);
}

bootstrap();
