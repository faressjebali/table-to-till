# Demo mode

Both web apps can run **without the server, the database or any `.env`**: a fake backend in the
browser answers the same routes, with the same shapes, as `docs/api.md`. It powers the live demo on
GitHub Pages and the local demo.

```bash
cd customer-web && npm ci && cd ../staff-app && npm ci && cd ..
npm run demo          # builds demo/dist/ and serves it on http://localhost:4173/
```

## How it works

| Piece | Role |
| --- | --- |
| `vite --mode demo` | Defines `VITE_DEMO`, aliases `socket.io-client` to `backend/bus.ts`, ignores push keys |
| `backend/install.ts` | Intercepts `fetch('/api/…')` before the network, adds the “Démo — données fictives” banner |
| `backend/server.ts` | Routes: menu, QR orders, confirm / reject, waiter orders, table plan, bar / kitchen, accounts. Prices are always computed from the menu, never taken from the client |
| `backend/state.ts` | The fictional café (staff, open tables, a pending QR order), kept in `localStorage` and shared by both apps on the same origin |
| `backend/bus.ts` | Fake real-time: events go to the right audience (waiters on shift, bar, kitchen, customers) and to other tabs via `BroadcastChannel` |
| `data/*.json` | Menu and table plan **recorded from the real server** (`npm run demo:data`, needs Docker) |

Outside demo mode none of this is bundled (`import.meta.env.VITE_DEMO` is replaced at build time,
the dynamic import is dropped).

Not simulated: the POS agent, payments, cancellations, closures and reports (not built yet in the
apps either). The demo clock ignores opening hours: everything orderable is available.

Demo accounts (staff app): `serveur`, `barista`, `cuisinier`, `manager`, `comptable` — password
`demo`. “Réinitialiser” in the banner restores the morning state.
