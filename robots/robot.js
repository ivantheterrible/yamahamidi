// robot.js: Defines the BlackOval (robot) custom element

// The audio context and preGain are expected to be defined in main.js
class BlackOval extends HTMLElement {
  static lastX = 60; // Track last X position for initial placement
  static lastY = 120; // Track last Y position for initial placement
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    container.classList.add('oval');
    const dragZone = document.createElement('div');
    dragZone.classList.add('drag-zone');
    const redDot = document.createElement('div');
    redDot.classList.add('dot', 'red');
    const redPupil = document.createElement('div');
    redPupil.classList.add('pupil');
    redDot.appendChild(redPupil);

    const greenDot = document.createElement('div');
    greenDot.classList.add('dot', 'green');
    const greenPupil = document.createElement('div');
    greenPupil.classList.add('pupil');
    greenDot.appendChild(greenPupil);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = 0;
    slider.max = 1;
    slider.step = 0.01;
    slider.value = 0.5;
    slider.classList.add('volume');
    const modBtn = document.createElement('div');
    modBtn.classList.add('mod-btn');
    modBtn.textContent = '~';
    const earRight = document.createElement('div');
    earRight.classList.add('ear', 'ear-right');
    const closeBtn = document.createElement('div');
    closeBtn.classList.add('close-btn');
    closeBtn.textContent = '×';
    const earLeft = document.createElement('div');
    earLeft.classList.add('ear', 'ear-left');
    earLeft.title = "Toggle chorus";
    // Unicode circle for ear
    const earChar = document.createElement('span');
    earChar.textContent = '●'; // Single circle by default
    earChar.style.fontSize = '20px';
    earChar.style.color = 'white';
    earChar.style.userSelect = 'none';
    earLeft.appendChild(earChar);
    earRight.appendChild(closeBtn);
    container.appendChild(dragZone);
    container.appendChild(redDot);
    container.appendChild(greenDot);
    container.appendChild(modBtn);
    container.appendChild(slider);
    container.appendChild(earRight);
    container.appendChild(earLeft);
    const style = document.createElement('style');
    style.textContent = `
      .oval {
        width: 200px;
        height: 100px;
        background: black;
        border-radius: 100px / 50px;
        position: relative;
        display: flex;
        justify-content: space-around;
        align-items: center;
      }
      .drag-zone {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        cursor: grab;
        z-index: 0;
      }
      .dot {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        position: relative;
        z-index: 1;
        filter: brightness(1);
        transition: filter 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .dot .pupil {
        width: 8px;
        height: 8px;
        background: #111;
        border-radius: 50%;
        pointer-events: none;
      }
      .dot.green.active {
        filter: brightness(1.5);
      }
      .dot.green:not(.active) {
        filter: brightness(0.5);
      }
      .dot.red.active {
        filter: brightness(0.5);
      }
      .dot.red:not(.active) {
        filter: brightness(1.5);
      }
      .red { background: #e22; }
      .green { background: #2e2; }
      .volume {
        width: 60px;
        position: absolute;
        bottom: 5px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1;
      }
      .mod-btn {
        position: absolute;
        top: 50px; /* Move button lower, below the eyes */
        left: 50%;
        transform: translateX(-50%);
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #333;
        color: white;
        font-size: 16px;
        line-height: 24px;
        text-align: center;
        cursor: pointer;
        z-index: 1;
        user-select: none;
        filter: brightness(1);
        transition: filter 0.2s;
      }
      .mod-btn.active {
        filter: brightness(1.5);
      }
      .ear {
        width: 28px;
        height: 28px;
        background: black;
        border-radius: 50%;
        position: absolute;
        top: 0px; /* Move ears even higher up */
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2;
        cursor: pointer;
      }
      .ear-right {
        right: 10px;
      }
      .ear-left {
        left: 10px;
      }
      .ear.active {
        filter: brightness(1.5);
      }
      .close-btn {
        color: white;
        font-size: 18px;
        user-select: none;
      }
    `;
    shadow.appendChild(style);
    shadow.appendChild(container);
    this.frequency = Math.random() * 380 + 120;
    this.oscillator = null;
    this.chorusOscillator = null;
    this.gainNode = window.audioCtx.createGain();
    // Set initial gain to match log scale at slider.value
    const minVol = 0.01, maxVol = 1;
    const v = parseFloat(slider.value);
    this.gainNode.gain.value = minVol * Math.pow(maxVol / minVol, v / 1);
    this.gainNode.connect(window.preGain);
    this.modulating = false;
    this.modFrame = null;
    this.modPhase = 0;
    this.chorusEnabled = false;
    this.globalFreqMultiplier = window.freqMultiplier || 1;
    this.targetFreqMultiplier = this.globalFreqMultiplier;
    this.freqAnimFrame = null;
    // Make both eyes toggle sound state
    const toggleSound = () => {
      if (this.oscillator) {
        this.stopTone();
        redDot.classList.add('active');
        greenDot.classList.remove('active');
      } else {
        this.startTone();
        greenDot.classList.add('active');
        redDot.classList.remove('active');
      }
    };
    greenDot.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSound();
    });

    redDot.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSound();
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cleanupAndRemove();
    });
    earLeft.addEventListener('click', (e) => {
      e.stopPropagation();
      this.chorusEnabled = !this.chorusEnabled;
      earLeft.classList.toggle('active', this.chorusEnabled);
      earChar.textContent = this.chorusEnabled ? '●●' : '●';
      // If main tone is playing, start/stop chorus oscillator accordingly
      if (this.oscillator) {
        if (this.chorusEnabled && !this.chorusOscillator) {
          this.startChorus();
        } else if (!this.chorusEnabled && this.chorusOscillator) {
          this.stopChorus();
        }
      }
    });
    slider.addEventListener('input', () => {
      this.gainNode.gain.value = parseFloat(slider.value);
    });
    modBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleModulation(modBtn, slider);
    });
    // Initial position: place further apart, increment horizontally by 220px, add vertical offset of 40px per robot, wrap if needed
    this.style.position = 'absolute';
    this.style.left = BlackOval.lastX + 'px';
    this.style.top = (BlackOval.lastY + (BlackOval.lastX - 60) / 220 * 40) + 'px'; // stagger vertically
    BlackOval.lastX += 220; // 220px horizontal spacing
    if (BlackOval.lastX > window.innerWidth - 220) { // wrap if too far right
      BlackOval.lastX = 60;
      BlackOval.lastY += 160; // more vertical space between rows
    }
    this._dragging = false;
    this._offsetX = 0;
    this._offsetY = 0;
    // Mouse drag events
    dragZone.addEventListener('mousedown', (e) => {
      this._dragging = true;
      this._offsetX = e.clientX - this.offsetLeft;
      this._offsetY = e.clientY - this.offsetTop;
      dragZone.style.cursor = 'grabbing';
    });
    // Touch support for mobile drag
    dragZone.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this._dragging = true;
        const touch = e.touches[0];
        this._offsetX = touch.clientX - this.offsetLeft;
        this._offsetY = touch.clientY - this.offsetTop;
        dragZone.style.cursor = 'grabbing';
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this._dragging) {
        this.style.left = `${e.clientX - this._offsetX}px`;
        this.style.top = `${e.clientY - this._offsetY}px`;
      }
    });
    // Touch move support
    window.addEventListener('touchmove', (e) => {
      if (this._dragging && e.touches.length === 1) {
        const touch = e.touches[0];
        this.style.left = `${touch.clientX - this._offsetX}px`;
        this.style.top = `${touch.clientY - this._offsetY}px`;
      }
    }, { passive: false });
    window.addEventListener('mouseup', () => {
      this._dragging = false;
      dragZone.style.cursor = 'grab';
    });
    // Touch end support
    window.addEventListener('touchend', () => {
      this._dragging = false;
      dragZone.style.cursor = 'grab';
    });
    // Set initial state: both eyes dark
    redDot.classList.add('active');
    greenDot.classList.remove('active');
  }
  // Add method to handle global frequency multiplier changes
  setGlobalFreqMultiplier(mult, animate = true) {
    if (this.freqAnimFrame) cancelAnimationFrame(this.freqAnimFrame);
    this.targetFreqMultiplier = mult;
    if (!this.oscillator && !this.chorusOscillator) {
      this.globalFreqMultiplier = mult;
      return;
    }
    const duration = 0.5; // seconds
    const audioCtx = window.audioCtx;
    const now = audioCtx.currentTime;
    if (animate && (this.oscillator || this.chorusOscillator)) {
      if (this.oscillator) {
        try {
          this.oscillator.frequency.cancelScheduledValues(now);
          this.oscillator.frequency.exponentialRampToValueAtTime(this.frequency * mult, now + duration);
        } catch (e) {}
      }
      if (this.chorusOscillator) {
        try {
          this.chorusOscillator.frequency.cancelScheduledValues(now);
          this.chorusOscillator.frequency.exponentialRampToValueAtTime((this.frequency + 2) * mult, now + duration);
        } catch (e) {}
      }
    } else {
      if (this.oscillator) {
        try {
          this.oscillator.frequency.setValueAtTime(this.frequency * mult, now);
        } catch (e) {}
      }
      if (this.chorusOscillator) {
        try {
          this.chorusOscillator.frequency.setValueAtTime((this.frequency + 2) * mult, now);
        } catch (e) {}
      }
    }
    this.globalFreqMultiplier = mult;
  }
  startTone() {
    this.stopTone();
    this.oscillator = window.audioCtx.createOscillator();
    this.oscillator.type = 'sine';
    this.oscillator.frequency.value = this.frequency * this.globalFreqMultiplier;
    this.oscillator.connect(this.gainNode);
    this.oscillator.start();
    if (this.chorusEnabled && !this.chorusOscillator) {
      this.startChorus();
    }
  }
  stopTone() {
    if (this.oscillator) {
      this.oscillator.stop();
      this.oscillator.disconnect();
      this.oscillator = null;
    }
    this.stopChorus();
  }
  startChorus() {
    this.chorusOscillator = window.audioCtx.createOscillator();
    this.chorusOscillator.type = 'sine';
    this.chorusOscillator.frequency.value = (this.frequency + 2) * this.globalFreqMultiplier;
    this.chorusOscillator.connect(this.gainNode);
    this.chorusOscillator.start();
  }
  stopChorus() {
    if (this.chorusOscillator) {
      this.chorusOscillator.stop();
      this.chorusOscillator.disconnect();
      this.chorusOscillator = null;
    }
  }
  toggleModulation(btn, slider) {
    this.modulating = !this.modulating;
    btn.classList.toggle('active', this.modulating);
    if (this.modulating) {
      this.modPhase = 0;
      const animate = () => {
        if (!this.modulating) return;
        const gain = 0.5 + 0.3 * Math.sin(this.modPhase);
        this.gainNode.gain.value = gain;
        slider.value = gain.toFixed(2);
        this.modPhase += 0.05;
        this.modFrame = requestAnimationFrame(animate);
      };
      animate();
    } else {
      cancelAnimationFrame(this.modFrame);
    }
  }
  cleanupAndRemove() {
    this.stopTone();
    cancelAnimationFrame(this.modFrame);
    this.gainNode.disconnect();
    this.remove();
  }
}
window.customElements.define('black-oval', BlackOval);
