/* WebAudio 合成音效，不依赖外部音频资源。首次用户手势后 BR.sfx.unlock() */
(function () {
  const BR = window.BR;
  let ac = null, master = null, drone = null;
  let noiseBuf = null;
  // ── 程序化 BGM：D 小调低音脉冲 + 时钟滴答 + 不协和 swell，4 小节循环 ──
  let bgmGain = null, bgmTimer = null, bgmStep = 0, bgmNext = 0;
  const BGM_BPM = 92;
  const BGM_BASS = [38, 38, 41, 36];   // D2 D2 F2 C2，每小节一个根音
  const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);

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
    },

    // 紧张 BGM（对局场景用）：lookahead 调度器，92 BPM 四小节循环。
    // 三层：低音脉冲（D-D-F-C 走向）、八分音符时钟滴答、每 4 小节一次 D+G# 三全音 swell。
    bgm(on) {
      const c = ctx(); if (!c) return;
      if (on && !bgmTimer) {
        if (!bgmGain) { bgmGain = c.createGain(); bgmGain.gain.value = 0.9; bgmGain.connect(master); }
        bgmStep = 0;
        bgmNext = c.currentTime + 0.1;
        bgmTimer = setInterval(bgmSchedule, 25);
      } else if (!on && bgmTimer) {
        clearInterval(bgmTimer); bgmTimer = null;
      }
    }
  };

  function bgmSchedule() {
    const c = ac; if (!c) return;
    const eighth = 60 / BGM_BPM / 2;
    while (bgmNext < c.currentTime + 0.15) {
      const t = bgmNext, s = bgmStep % 32, bar = (s / 8) | 0;
      // 低音脉冲：每拍一个短促 sawtooth，低通压暗
      if (s % 2 === 0) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = mf(BGM_BASS[bar]);
        const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 320;
        const gn = c.createGain();
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.exponentialRampToValueAtTime(0.15, t + 0.012);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(fl); fl.connect(gn); gn.connect(bgmGain);
        o.start(t); o.stop(t + 0.34);
      }
      // 时钟滴答：每个八分音符一次，强弱交替（每小节第一拍最响）
      const src = c.createBufferSource(); src.buffer = noiseBuf;
      const bf = c.createBiquadFilter(); bf.type = 'bandpass';
      bf.frequency.value = s % 2 ? 5200 : 3900;
      const tg = c.createGain();
      tg.gain.setValueAtTime(s % 8 === 0 ? 0.05 : (s % 2 === 0 ? 0.03 : 0.018), t);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(bf); bf.connect(tg); tg.connect(bgmGain);
      src.start(t); src.stop(t + 0.08);
      // 每 4 小节第 4 拍起：D4+G#4 三全音 swell（缓慢上滑制造不安感）
      if (s === 28) {
        [62, 68].forEach((m) => {
          const o = c.createOscillator(); o.type = 'triangle';
          o.frequency.setValueAtTime(mf(m), t);
          o.frequency.linearRampToValueAtTime(mf(m) * 1.012, t + 1.8);
          const gn = c.createGain();
          gn.gain.setValueAtTime(0.0001, t);
          gn.gain.exponentialRampToValueAtTime(0.04, t + 1.3);
          gn.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
          o.connect(gn); gn.connect(bgmGain);
          o.start(t); o.stop(t + 2.7);
        });
      }
      bgmStep++;
      bgmNext += eighth;
    }
  }
})();
