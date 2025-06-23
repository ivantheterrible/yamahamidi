// main.js: Audio setup, global controls, oscilloscope, and robot creation

window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
window.preGain = audioCtx.createGain();
const distortion = audioCtx.createWaveShaper();
const postGain = audioCtx.createGain();
const analyser = audioCtx.createAnalyser();
preGain.connect(distortion);
distortion.connect(postGain);
postGain.connect(analyser);
analyser.connect(audioCtx.destination);
preGain.gain.value = 1;
postGain.gain.value = 1;
analyser.fftSize = 1024;
function makeDistortionCurve(type) {
  const n = 44100;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    switch (type) {
      case 'soft':
        curve[i] = Math.tanh(2 * x);
        break;
      case 'hard':
        curve[i] = Math.max(-0.3, Math.min(0.3, x));
        break;
      case 'fold':
        curve[i] = Math.abs(x) > 0.5 ? (Math.abs(x - 1) - 0.5) : x;
        break;
    }
  }
  return curve;
}
distortion.curve = makeDistortionCurve('soft');
distortion.oversample = '4x';
document.getElementById('preGainSlider').oninput = e => {
  // Log scale: slider 0-10 mapped to gain 0.01 to 10
  const min = 0.01, max = 10;
  const v = parseFloat(e.target.value);
  const gain = min * Math.pow(max / min, v / 10);
  preGain.gain.value = gain;
};
document.getElementById('postGainSlider').oninput = e => {
  // Log scale: slider 0-1 mapped to gain 0.01 to 1
  const min = 0.01, max = 1;
  const v = parseFloat(e.target.value);
  const gain = min * Math.pow(max / min, v / 1);
  postGain.gain.value = gain;
};
document.getElementById('distortionType').onchange = e => {
  distortion.curve = makeDistortionCurve(e.target.value);
};
const canvas = document.getElementById('output-scope');
const ctx = canvas.getContext('2d');
const bufferLength = analyser.fftSize;
const dataArray = new Uint8Array(bufferLength);
function drawScope() {
  requestAnimationFrame(drawScope);
  analyser.getByteTimeDomainData(dataArray);
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#0f0';
  ctx.beginPath();
  const sliceWidth = canvas.width / bufferLength;
  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * canvas.height) / 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.stroke();
}
drawScope();
customElements.whenDefined('black-oval').then(() => {
  document.getElementById('addBtn').addEventListener('click', () => {
    const OvalClass = customElements.get('black-oval');
    const oval = new OvalClass();

    const robotWidth = 60; // Approximate width of the robot
    const robotHeight = 120; // Approximate height of the robot
    const maxAttempts = 100; // Maximum attempts to find a non-overlapping position

    const exclusionZones = [
      document.querySelector('.freq-mult-bar').getBoundingClientRect(),
      document.querySelector('.global-controls').getBoundingClientRect()
    ];

    let positionFound = false;
    let attempts = 0;
    let left, top;

    while (!positionFound && attempts < maxAttempts) {
      // Generate random positions within the visible screen area
      left = Math.random() * (window.innerWidth - robotWidth);
      top = Math.random() * (window.innerHeight - robotHeight);

      // Check for overlap with existing robots and exclusion zones
      positionFound = !Array.from(document.querySelectorAll('black-oval')).some(existingOval => {
        const rect = existingOval.getBoundingClientRect();
        return (
          left < rect.right &&
          left + robotWidth > rect.left &&
          top < rect.bottom &&
          top + robotHeight > rect.top
        );
      }) && !exclusionZones.some(zone => {
        return (
          left < zone.right &&
          left + robotWidth > zone.left &&
          top < zone.bottom &&
          top + robotHeight > zone.top
        );
      });

      attempts++;
    }

    if (positionFound) {
      // Set the position of the new robot
      oval.style.position = 'absolute';
      oval.style.left = `${left}px`;
      oval.style.top = `${top}px`;
      document.body.appendChild(oval);
    } else {
      console.warn('Could not find a non-overlapping position for the new robot.');
    }
  });
});
// Frequency multiplier logic
window.freqMultiplier = 1;
const freqMultSlider = document.getElementById('freqMultSlider');
// Map slider value (0-1) to log scale 0.5x to 2x
function sliderToMultiplier(val) {
  return 0.5 * Math.pow(4, val); // 0.5 * 4^val, val in [0,1]
}
function multiplierToSlider(mult) {
  return Math.log2(mult / 0.5) / 2; // inverse of above
}
let freqMultAnimFrame = null;
let freqMultAnimStart = null;
let freqMultAnimFrom = 1;
let freqMultAnimTo = 1;
function setFreqMultiplier(mult, animate = true) {
  if (freqMultAnimFrame) cancelAnimationFrame(freqMultAnimFrame);
  if (!animate) {
    window.freqMultiplier = mult;
    freqMultSlider.value = multiplierToSlider(mult);
    document.querySelectorAll('black-oval').forEach(el => {
      if (el.setGlobalFreqMultiplier) el.setGlobalFreqMultiplier(mult, false);
    });
    return;
  }
  freqMultAnimStart = performance.now();
  freqMultAnimFrom = window.freqMultiplier;
  freqMultAnimTo = mult;
  function animateStep(now) {
    let t = Math.min((now - freqMultAnimStart) / 500, 1);
    // Ease in-out
    t = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    const curMult = freqMultAnimFrom + (freqMultAnimTo - freqMultAnimFrom) * t;
    window.freqMultiplier = curMult;
    freqMultSlider.value = multiplierToSlider(curMult);
    document.querySelectorAll('black-oval').forEach(el => {
      if (el.setGlobalFreqMultiplier) el.setGlobalFreqMultiplier(curMult, true);
    });
    if (t < 1) {
      freqMultAnimFrame = requestAnimationFrame(animateStep);
    } else {
      window.freqMultiplier = mult;
      freqMultSlider.value = multiplierToSlider(mult);
      document.querySelectorAll('black-oval').forEach(el => {
        if (el.setGlobalFreqMultiplier) el.setGlobalFreqMultiplier(mult, false);
      });
    }
  }
  freqMultAnimFrame = requestAnimationFrame(animateStep);
}
freqMultSlider.addEventListener('input', e => {
  const mult = sliderToMultiplier(parseFloat(e.target.value));
  setFreqMultiplier(mult, true);
});
// On load, set to unity
setFreqMultiplier(1, false);
document.getElementById('preGainSlider').value = Math.log10(preGain.gain.value / 0.01) / Math.log10(10 / 0.01) * 10;
document.getElementById('postGainSlider').value = Math.log10(postGain.gain.value / 0.01) / Math.log10(1 / 0.01) * 1;
function adjustButtonPositions() {
  const instructionsHeight = document.querySelector('.instructions').offsetHeight;
  const freqBarHeight = document.querySelector('.freq-mult-bar').offsetHeight;

  const addButton = document.querySelector('.add-button');
  const globalControls = document.querySelector('.global-controls');

  const newTop = instructionsHeight + freqBarHeight + 8; // Add some spacing

  addButton.style.top = `${newTop}px`;
  globalControls.style.top = `${newTop}px`;
}

window.addEventListener('resize', adjustButtonPositions);
window.addEventListener('load', adjustButtonPositions);
