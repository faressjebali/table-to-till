// Son court joué à chaque nouvelle commande (et plus grave pour une annulation), app ouverte.
// Les navigateurs, Safari surtout, n'autorisent le son qu'après un premier toucher : le contexte
// audio est débloqué au premier toucher sur l'écran.
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (context) return context;
  if (typeof AudioContext === 'undefined') return null;
  context = new AudioContext();
  return context;
}

/** À appeler une fois au démarrage : débloque le son au premier toucher. */
export function unlockSoundOnFirstTouch() {
  const unlock = () => {
    void audio()?.resume();
  };
  document.addEventListener('pointerdown', unlock, { once: true });
}

/** Deux notes : `new` aiguës (nouvelle commande, prêt), `alert` graves (annulation). */
export function playChime(kind: 'new' | 'alert' = 'new') {
  const ctx = audio();
  if (!ctx || ctx.state !== 'running') return;
  const notes = kind === 'new' ? [880, 1320] : [440, 330];
  notes.forEach((frequency, i) => {
    const start = ctx.currentTime + i * 0.18;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.3, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.16);
  });
}
