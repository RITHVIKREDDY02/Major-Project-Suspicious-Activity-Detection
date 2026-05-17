import { useRef, useCallback, useEffect, useState } from "react";

export function useAlarm() {
  const ctxRef   = useRef<AudioContext | null>(null);
  const loopRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [muted,  setMuted]  = useState(false);
  const [ringing, setRinging] = useState(false);
  const mutedRef = useRef(muted);

  useEffect(() => { mutedRef.current = muted; }, [muted]);

  function getCtx() {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext();
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  }

  // Play a single two-tone "beep-beep" burst
  const playBurst = useCallback(() => {
    if (mutedRef.current) return;
    const ctx = getCtx();

    const freqs  = [880, 660]; // hi-lo tones
    const durations = [0.18, 0.18];
    let time = ctx.currentTime;

    for (let rep = 0; rep < 3; rep++) {
      freqs.forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type      = "square";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.4, time + 0.01);
        gain.gain.linearRampToValueAtTime(0,   time + durations[i] - 0.01);
        osc.start(time);
        osc.stop(time + durations[i]);
        time += durations[i];
      });
      time += 0.06; // gap between pairs
    }
  }, []);

  const startAlarm = useCallback(() => {
    if (ringing) return;
    setRinging(true);
    playBurst();
    loopRef.current = setInterval(playBurst, 2800);
  }, [ringing, playBurst]);

  const stopAlarm = useCallback(() => {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null; }
    setRinging(false);
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  useEffect(() => () => {
    if (loopRef.current) clearInterval(loopRef.current);
    ctxRef.current?.close();
  }, []);

  return { startAlarm, stopAlarm, toggleMute, muted, ringing };
}
