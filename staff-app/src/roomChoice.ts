import type { Room } from './api/types';

// Salle affichée sur le plan des tables : la dernière choisie sur ce téléphone.

export const ROOMS: Room[] = ['inside', 'terrace'];

const KEY = 'coffee-qr.staff.room';
let memoryRoom: Room = 'inside';

/** Dernière salle affichée sur ce téléphone ; l'intérieur par défaut. */
export function loadRoom(): Room {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'terrace' || stored === 'inside' ? stored : 'inside';
  } catch {
    return memoryRoom;
  }
}

export function saveRoom(room: Room): void {
  memoryRoom = room;
  try {
    localStorage.setItem(KEY, room);
  } catch {
    // Sans stockage : le choix vaut pour la visite.
  }
}
