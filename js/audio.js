/* WebAudio 合成音效，不依赖外部音频资源。首次用户手势后 BR.sfx.unlock() */
(function () {
  const BR = window.BR;
  let ac = null, master = null, drone = null;
  let noiseBuf = null;

  function ctx() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.6; master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ac;
  }

  function env(node, t, a, peak, dec) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  function noise(dur, freq, peak, type) {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
    const gn = c.createGain(); env(gn, t, 0.003, peak, dur);
    src.connect(f); f.connect(gn); gn.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  function tone(freq, dur, peak, type, slide) {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const gn = c.createGain(); env(gn, t, 0.005, peak, dur);
    o.connect(gn); gn.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  BR.sfx = {
    unlock() { const c = ctx(); if (c && c.state === 'suspended') c.resume(); },
    shot() { noise(0.6, 1800, 1.0); tone(70, 0.4, 0.8, 'sine', 30); },
    click() { noise(0.04, 4000, 0.5, 'highpass'); },
    rack() { noise(0.08, 2500, 0.4, 'bandpass'); setTimeout(() => noise(0.1, 1500, 0.5, 'bandpass'), 140); },
    load() { noise(0.05, 3000, 0.3, 'bandpass'); },
    zap() { tone(900, 0.35, 0.3, 'sawtooth', 60); noise(0.3, 6000, 0.2, 'highpass'); },
    heal() { tone(440, 0.15, 0.15, 'square'); setTimeout(() => tone(660, 0.2, 0.15, 'square'), 120); },
    beep() { tone(1200, 0.06, 0.12, 'square'); },
    item() { tone(300, 0.08, 0.2, 'triangle'); },
    saw() { for (let i = 0; i < 4; i++) setTimeout(() => noise(0.07, 3500, 0.35, 'bandpass'), i * 90); },
    cuff() { tone(1800, 0.05, 0.2, 'square'); setTimeout(() => noise(0.06, 5000, 0.3, 'highpass'), 60); },
    heart() { tone(55, 0.15, 0.6, 'sine', 40); setTimeout(() => tone(50, 0.12, 0.4, 'sine', 35), 180); },
    phone() { [0, 200, 400].forEach((d) => setTimeout(() => tone(850, 0.12, 0.12, 'square'), d)); },
    door() { noise(0.4, 400, 0.9); tone(60, 0.3, 0.5, 'sine', 30); },
    drone(on) {
      const c = ctx(); if (!c) return;
      if (on && !drone) {
        const o = c.createOscillator(), o2 = c.createOscillator(), gn = c.createGain();
        o.type = 'sawtooth'; o.frequency.value = 41; o2.type = 'sine'; o2.frequency.value = 61.7;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
        gn.gain.value = 0.08;
        o.connect(f); o2.connect(f); f.connect(gn); gn.connect(master);
        o.start(); o2.start();
        drone = { o, o2, gn };
      } else if (!on && drone) {
        drone.o.stop(); drone.o2.stop(); drone = null;
      }
    }
  };
})();
