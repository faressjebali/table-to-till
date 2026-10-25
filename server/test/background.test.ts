import { describe, expect, it, vi } from 'vitest';
import { runInBackground, settleBackground } from '../src/background.js';

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('travail en arrière-plan', () => {
  it('ne bloque pas l’appelant ; settleBackground attend la fin, même des tâches lancées entre-temps', async () => {
    const done: string[] = [];
    runInBackground('test', async () => {
      await later(20);
      done.push('première');
      runInBackground('test', async () => {
        await later(20);
        done.push('lancée pendant l’attente');
      });
    });
    expect(done).toEqual([]);
    await settleBackground();
    expect(done).toEqual(['première', 'lancée pendant l’attente']);
  });

  it('une erreur est journalisée, jamais relancée', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('service push injoignable');
    runInBackground('notifications push (test)', () => Promise.reject(failure));
    await settleBackground();
    expect(error).toHaveBeenCalledWith('notifications push (test) :', failure);
    error.mockRestore();
  });
});
