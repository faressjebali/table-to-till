import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useLanguage } from '../i18n/useLanguage';

// Panneau qui monte du bas (fiche article, panier) : `role="dialog"`, focus sur ✕ à l'ouverture
// et rendu à l'élément d'origine à la fermeture ; ✕, Échap, le fond sombre ou la poignée glissée
// vers le bas ferment. `footer` reste visible sous le contenu qui défile.
export function Sheet({
  labelledBy,
  onClose,
  footer,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const closeRef = useRef<HTMLButtonElement>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  // Glisser la poignée vers le bas ferme le panneau (comme une feuille iOS) ; sinon il revient.
  const [drag, setDrag] = useState<{ startY: number; dy: number } | null>(null);
  const onGrabberDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ startY: event.clientY, dy: 0 });
  };
  const onGrabberMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag) setDrag({ ...drag, dy: Math.max(0, event.clientY - drag.startY) });
  };
  const onGrabberUp = () => {
    if (drag && drag.dy > 100) onClose();
    setDrag(null);
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={
          drag ? { transform: `translateY(${String(drag.dy)}px)`, transition: 'none' } : undefined
        }
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="sheet__grabber"
          aria-hidden="true"
          onPointerDown={onGrabberDown}
          onPointerMove={onGrabberMove}
          onPointerUp={onGrabberUp}
          onPointerCancel={() => setDrag(null)}
        />
        <div className="sheet__scroll">
          <button
            ref={closeRef}
            type="button"
            className="sheet__close"
            aria-label={t('sheet.close')}
            onClick={onClose}
          >
            ✕
          </button>
          {children}
        </div>
        {footer && <div className="sheet__footer">{footer}</div>}
      </div>
    </div>
  );
}
