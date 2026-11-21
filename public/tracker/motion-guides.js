'use strict';

const machineGuides = [
  {
    id: 'lat-pulldown',
    exerciseId: 'pulldown',
    name: 'Lat pulldown',
    duration: 4600,
    cues: [
      ['Set up', 'Secure your thighs under the pad. Start with arms overhead and keep your feet planted.'],
      ['Pull', 'Drive your elbows down and bring the bar toward your upper chest. Keep your torso steady.'],
      ['Return', 'Let your arms reach overhead again with control.']
    ],
    draw: drawPulldown
  },
  {
    id: 'sled-leg-press',
    exerciseId: 'legpress',
    name: '45° leg press',
    duration: 5400,
    cues: [
      ['Set up', 'Plant your feet on the platform and keep your hips and back against the pad.'],
      ['Lower', 'Bend your knees in line with your toes. Stop before your hips roll off the pad.'],
      ['Press', 'Push through your whole foot. Finish with a slight bend in your knees.']
    ],
    draw: drawLegPress
  }
];

function interpolate(start, end, fraction) {
  return start + (end - start) * fraction;
}

function limbJoint(start, end, upperLength, lowerLength, direction) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const distance = Math.hypot(dx, dy);
  const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)) * direction;
  return [
    start[0] + (along * dx - bend * dy) / distance,
    start[1] + (along * dy + bend * dx) / distance
  ];
}

function drawPulldown(scene, amount) {
  const { equipment, pad, body, accent } = scene;
  const center = ([x, y]) => [x + 58, y];
  const line = (colour, width, ...points) => scene.line(colour, width, ...points.map(center));
  const dot = (colour, radius, point) => scene.dot(colour, radius, center(point));
  const shoulder = [147, 111];
  const hip = [152, 165];
  const hand = [126, interpolate(40, 111, amount)];
  const elbow = limbJoint(shoulder, hand, 39, 37, -1);
  const weight = interpolate(190, 131, amount);

  line(equipment, 5, [85, 214], [85, 23], [126, 23]);
  line(equipment, 3, [60, 103], [60, 207]);
  line(equipment, 10, [60, weight], [85, weight]);
  line(equipment, 2, [60, weight - 5], [60, 23], [126, 23], hand);
  dot(equipment, 5, [126, 23]);
  line(equipment, 6, [134, 212], [147, 173], [178, 173]);
  line(pad, 9, [142, 174], [176, 174]);
  line(body, 11, shoulder, hip, [118, 168], [118, 211], [101, 211]);
  line(pad, 9, [104, 154], [133, 154]);
  dot(body, 12, [145, 88]);
  line(accent, 8, shoulder, elbow, hand);
  line(body, 5, [107, hand[1] + 4], [114, hand[1]], [138, hand[1]], [145, hand[1] + 4]);
}

function drawLegPress({ line, dot, equipment, pad, body, accent }, amount) {
  const hip = [101, 182];
  const foot = [interpolate(209, 170, amount), interpolate(104, 143, amount)];
  const knee = limbJoint(hip, foot, 68, 67, -1);
  const plateEnd = [foot[0] + 23, foot[1] + 23];

  line(equipment, 6, [146, 213], [278, 81]);
  line(equipment, 5, [267, 213], [267, 92]);
  line(equipment, 8, [plateEnd[0] + 4, plateEnd[1]], plateEnd);
  line(equipment, 11, [foot[0] - 17, foot[1] - 17], plateEnd);
  line(equipment, 6, [232, 55], [278, 81]);
  line(equipment, 4, [52, 188], [87, 188], [87, 213]);
  line(pad, 11, [47, 143], [96, 190], [121, 190]);
  line(body, 13, [66, 155], hip);
  dot(body, 12, [55, 134]);
  line(accent, 9, hip, knee, foot);
  line(body, 6, [foot[0] - 10, foot[1] - 10], foot);
  line(body, 6, [71, 158], [81, 176], [99, 175]);
}

class ExerciseMotion extends HTMLElement {
  connectedCallback() {
    const guide = machineGuides.find(item => item.id === this.dataset.machine);
    if (!guide) return;
    this.guide = guide;
    this.step = null;
    this.preference = matchMedia('(prefers-reduced-motion: reduce)');
    this.innerHTML = `
      <h2>Animated technique</h2>
      <canvas class="motion-scene" width="720" height="480" aria-hidden="true"></canvas>
      <div class="motion-controls" role="group" aria-label="Technique steps">
        ${guide.cues.map(([label], index) => `<button type="button" class="btn secondary small" data-step="${index}" aria-pressed="false">${label}</button>`).join('')}
      </div>
      <div class="motion-cue" aria-live="polite"></div>
      <button class="btn primary motion-play" type="button">Play one rep</button>`;
    this.context = this.querySelector('canvas').getContext('2d');
    this.stepButtons = [...this.querySelectorAll('[data-step]')];
    this.cue = this.querySelector('.motion-cue');
    this.playButton = this.querySelector('.motion-play');
    this.stepButtons.forEach((button, index) => {
      button.onclick = () => {
        this.stop();
        this.showStep(index);
      };
    });
    this.playButton.onclick = () => this.playing ? this.stop() : this.play();
    this.syncPreference = () => {
      if (this.preference.matches) {
        this.stop();
        this.showStep(this.step ?? 0);
      }
      this.playButton.hidden = this.preference.matches || !this.context;
    };
    this.preference.addEventListener('change', this.syncPreference);
    this.showStep(0);
    this.syncPreference();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.frame);
    this.preference?.removeEventListener('change', this.syncPreference);
  }

  updateCue(step) {
    if (this.step === step) return;
    this.step = step;
    const [title, text] = this.guide.cues[step];
    this.cue.textContent = `${title} · ${text}`;
    this.stepButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(step === index)));
  }

  showStep(step) {
    this.updateCue(step);
    this.draw(step === 1 ? 1 : step === 2 ? 0.28 : 0);
  }

  draw(amount) {
    const ctx = this.context;
    if (!ctx) return;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, 360, 240);
    const line = (colour, width, ...points) => {
      ctx.beginPath();
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(...points[0]);
      points.slice(1).forEach(point => ctx.lineTo(...point));
      ctx.stroke();
    };
    const dot = (colour, radius, point) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(...point, radius, 0, Math.PI * 2);
      ctx.fill();
    };
    line('#375365', 2, [30, 219], [330, 219]);
    this.guide.draw({ line, dot, equipment: '#7494a8', pad: '#527285', body: '#edf5fa', accent: '#79ebcc' }, amount);
  }

  play() {
    this.playing = true;
    this.playButton.textContent = 'Stop animation';
    const start = performance.now();
    const tick = time => {
      const elapsed = Math.min(1, (time - start) / this.guide.duration);
      const motion = Math.min(1, Math.max(0, (elapsed - 0.15) / 0.85));
      const amount = (1 - Math.cos(motion * 2 * Math.PI)) / 2;
      this.updateCue(elapsed < 0.15 ? 0 : motion < 0.5 ? 1 : 2);
      this.draw(amount);
      if (elapsed < 1) {
        this.frame = requestAnimationFrame(tick);
      } else {
        this.playing = false;
        this.playButton.textContent = 'Replay one rep';
      }
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.playing = false;
    this.playButton.textContent = 'Play one rep';
  }
}

customElements.define('exercise-motion', ExerciseMotion);
