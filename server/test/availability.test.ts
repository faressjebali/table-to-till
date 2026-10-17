import { describe, expect, it } from 'vitest';
import { computeAvailability, isWithinHours, localTime } from '../src/menu/availability.js';

// Tunis est en UTC+1 toute l'année. Le 19/10/2026 est un lundi, le 24/10/2026 un samedi.
const tunis = (date: string, time: string) => new Date(`${date}T${time}:00+01:00`);
const monday = (time: string) => tunis('2026-10-19', time);
const saturday = (time: string) => tunis('2026-10-24', time);

const everyDay = [1, 2, 3, 4, 5, 6, 7];
const allDay = { days: everyDay, from: null, until: null };
// Tels que chargés par le seed (« until » part de l'ouverture : 08:00).
const breakfast = { days: everyDay, from: '08:00', until: '12:00' };
const eggs = { days: everyDay, from: '08:00', until: '15:00' };
const dishOfTheWeek = { days: [1, 2, 3, 4, 5], from: '08:00', until: '15:00' };

describe('localTime', () => {
  it("donne l'heure de Tunis, pas celle du serveur", () => {
    expect(localTime(new Date('2026-10-19T07:00:00Z'))).toEqual({ day: 1, minutes: 8 * 60 });
  });

  it('change de jour à minuit heure de Tunis, pas à minuit UTC', () => {
    // 23h30 UTC le dimanche = 0h30 le lundi à Tunis.
    expect(localTime(new Date('2026-10-18T23:30:00Z'))).toEqual({ day: 1, minutes: 30 });
  });
});

describe('isWithinHours', () => {
  it("suit l'ouverture du café (8h00–22h00) sans horaire propre", () => {
    expect(isWithinHours(allDay, monday('07:59'))).toBe(false);
    expect(isWithinHours(allDay, monday('08:00'))).toBe(true);
    expect(isWithinHours(allDay, monday('21:59'))).toBe(true);
    expect(isWithinHours(allDay, monday('22:00'))).toBe(false);
  });

  it('formules petit-déjeuner : 8h00–12h00', () => {
    expect(isWithinHours(breakfast, monday('07:59'))).toBe(false);
    expect(isWithinHours(breakfast, monday('08:00'))).toBe(true);
    expect(isWithinHours(breakfast, monday('11:59'))).toBe(true);
    expect(isWithinHours(breakfast, monday('12:00'))).toBe(false);
  });

  it('œufs : 8h00–15h00', () => {
    expect(isWithinHours(eggs, monday('14:59'))).toBe(true);
    expect(isWithinHours(eggs, monday('15:00'))).toBe(false);
  });

  it('Plat de la semaine : lundi au vendredi, 8h00–15h00', () => {
    expect(isWithinHours(dishOfTheWeek, monday('12:30'))).toBe(true);
    expect(isWithinHours(dishOfTheWeek, monday('15:00'))).toBe(false);
    expect(isWithinHours(dishOfTheWeek, tunis('2026-10-23', '12:30'))).toBe(true);
    expect(isWithinHours(dishOfTheWeek, saturday('12:30'))).toBe(false);
    expect(isWithinHours(dishOfTheWeek, tunis('2026-10-25', '12:30'))).toBe(false);
  });

  it("ne dépasse jamais l'ouverture du café", () => {
    const late = { days: everyDay, from: '06:00', until: '23:30' };
    expect(isWithinHours(late, monday('07:00'))).toBe(false);
    expect(isWithinHours(late, monday('22:30'))).toBe(false);
  });

  it('accepte le format HH:MM:SS de PostgreSQL', () => {
    expect(isWithinHours({ ...breakfast, until: '12:00:00' }, monday('11:59'))).toBe(true);
    expect(isWithinHours({ ...breakfast, until: '12:00:00' }, monday('12:00'))).toBe(false);
  });
});

describe('isWithinHours pour le staff', () => {
  it("ignore l'ouverture du café pour un article sans horaire propre", () => {
    expect(isWithinHours(allDay, monday('07:30'), 'staff')).toBe(true);
    expect(isWithinHours(allDay, monday('22:30'), 'staff')).toBe(true);
    expect(isWithinHours(allDay, monday('00:00'), 'staff')).toBe(true);
  });

  it('applique toujours les horaires propres des articles', () => {
    expect(isWithinHours(breakfast, monday('07:30'), 'staff')).toBe(false);
    expect(isWithinHours(breakfast, monday('08:00'), 'staff')).toBe(true);
    expect(isWithinHours(breakfast, monday('22:30'), 'staff')).toBe(false);
    expect(isWithinHours(eggs, monday('07:30'), 'staff')).toBe(false);
    expect(isWithinHours(eggs, monday('15:00'), 'staff')).toBe(false);
    expect(isWithinHours(dishOfTheWeek, saturday('12:30'), 'staff')).toBe(false);
  });

  it('suit seulement la borne propre que l’article a', () => {
    const late = { days: everyDay, from: '06:00', until: '23:30' };
    expect(isWithinHours(late, monday('07:00'), 'staff')).toBe(true);
    expect(isWithinHours(late, monday('22:30'), 'staff')).toBe(true);
    expect(isWithinHours(late, monday('23:30'), 'staff')).toBe(false);
    expect(
      isWithinHours({ days: everyDay, from: null, until: '12:00' }, monday('06:00'), 'staff'),
    ).toBe(true);
  });
});

describe('computeAvailability', () => {
  it('disponible pendant ses horaires et sans rupture', () => {
    expect(computeAvailability({ ...allDay, soldOut: false }, monday('10:00'))).toEqual({
      available: true,
      unavailableReason: null,
    });
  });

  it('rupture → sold_out', () => {
    expect(computeAvailability({ ...allDay, soldOut: true }, monday('10:00'))).toEqual({
      available: false,
      unavailableReason: 'sold_out',
    });
  });

  it('staff : disponible après la fermeture, rupture toujours appliquée', () => {
    expect(computeAvailability({ ...allDay, soldOut: false }, monday('22:30'), 'staff')).toEqual({
      available: true,
      unavailableReason: null,
    });
    expect(computeAvailability({ ...allDay, soldOut: true }, monday('22:30'), 'staff')).toEqual({
      available: false,
      unavailableReason: 'sold_out',
    });
    expect(computeAvailability({ ...allDay, soldOut: false }, monday('22:30'))).toEqual({
      available: false,
      unavailableReason: 'outside_hours',
    });
  });

  it("hors horaire l'emporte sur la rupture", () => {
    expect(computeAvailability({ ...breakfast, soldOut: true }, monday('13:00'))).toEqual({
      available: false,
      unavailableReason: 'outside_hours',
    });
  });
});
