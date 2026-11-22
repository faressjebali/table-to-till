#!/usr/bin/env bash
# Régénère les données de la démo (demo/data/*.json) à partir du VRAI serveur :
# menu (vue client et vue staff) et plan des tables, au format exact de docs/api.md.
# À relancer quand docs/menu/menu.csv ou docs/tables.csv changent.
#
# Prérequis : Docker et `npm ci` dans server/. Lance un Postgres jetable sur le port 55432
# (supprimé à la fin) et le serveur sur le port 3999 ; n'utilise pas votre .env.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/demo/data"
mkdir -p "$out"

export DATABASE_URL=postgresql://coffee:demo@localhost:55432/coffee_qr
export PORT=3999 FIRST_MANAGER_LOGIN=manager FIRST_MANAGER_TEMP_PASSWORD=snapshot-temp
export AGENT_KEY=snapshot-agent-key-not-secret
api=http://localhost:3999/api

docker run -d --rm --name demo-snapshot-pg -e POSTGRES_USER=coffee -e POSTGRES_PASSWORD=demo \
  -e POSTGRES_DB=coffee_qr -p 127.0.0.1:55432:5432 postgres:16 >/dev/null
cleanup() {
  if [ -n "${server_pid:-}" ]; then
    # Sous Windows (Git Bash), `kill` n'atteint pas le processus Node lancé par npx : on arrête
    # tout l'arbre de processus avec taskkill.
    if [ -r "/proc/$server_pid/winpid" ] && command -v taskkill >/dev/null 2>&1; then
      taskkill //F //T //PID "$(cat "/proc/$server_pid/winpid")" >/dev/null 2>&1 || true
    else
      kill "$server_pid" 2>/dev/null || true
    fi
  fi
  docker stop demo-snapshot-pg >/dev/null 2>&1 || true
}
trap cleanup EXIT
until docker exec demo-snapshot-pg pg_isready -U coffee -d coffee_qr >/dev/null 2>&1; do sleep 1; done
sleep 2

cd "$root/server"
npx tsx src/migrate.ts >/dev/null
npx tsx src/seed/index.ts >/dev/null
npx tsx src/index.ts >/dev/null 2>&1 &
server_pid=$!
until curl -sf "$api/health" >/dev/null; do sleep 1; done

json() { curl -sf -H 'Content-Type: application/json' "$@"; }
token_of() { node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))"; }

# Manager : premier mot de passe changé, puis un serveur en shift pour lire le plan.
mtok=$(json -X POST "$api/auth/login" -d '{"login":"manager","password":"snapshot-temp"}' | token_of)
json -X POST "$api/auth/change-password" -H "Authorization: Bearer $mtok" \
  -d '{"currentPassword":"snapshot-temp","newPassword":"snapshot-manager-1"}' >/dev/null
wpass=$(json -X POST "$api/users" -H "Authorization: Bearer $mtok" \
  -d '{"name":"Snapshot","login":"snapshot","role":"waiter"}' |
  node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).temporaryPassword))")
wtok=$(json -X POST "$api/auth/login" -d "{\"login\":\"snapshot\",\"password\":\"$wpass\"}" | token_of)
json -X POST "$api/auth/change-password" -H "Authorization: Bearer $wtok" \
  -d "{\"currentPassword\":\"$wpass\",\"newPassword\":\"snapshot-waiter-1\"}" >/dev/null
json -X POST "$api/shifts/start" -H "Authorization: Bearer $wtok" -d '{}' >/dev/null

json "$api/menu" > "$out/menu-customer.json"
json "$api/menu" -H "Authorization: Bearer $wtok" > "$out/menu-staff.json"
json "$api/tables" -H "Authorization: Bearer $wtok" > "$out/tables.json"
cd "$root" && npx prettier --write demo/data >/dev/null
echo "Données de la démo écrites dans demo/data/"
