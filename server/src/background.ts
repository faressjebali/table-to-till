// Travail lancé après la réponse, sans l'attendre (notifications push) : le service push peut
// être lent, et un échec ne change rien à l'action déjà enregistrée. Les tâches en cours sont
// gardées pour que les tests attendent leur fin avant de vider la base : sinon leurs lectures
// et le TRUNCATE du test suivant se bloquent mutuellement (deadlock).
const pending = new Set<Promise<void>>();

export function runInBackground(label: string, work: () => Promise<void>): void {
  const task = (async () => {
    try {
      await work();
    } catch (err) {
      console.error(`${label} :`, err);
    }
  })();
  pending.add(task);
  void task.finally(() => pending.delete(task));
}

// Attend la fin de toutes les tâches en cours, y compris celles lancées pendant l'attente.
export async function settleBackground(): Promise<void> {
  while (pending.size > 0) await Promise.all(pending);
}
