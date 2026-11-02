#!/usr/bin/env bash
# Återställ databasen från en backup i R2. Körs på servern.
#
#   ./restore.sh                                  visar alla backuper
#   ./restore.sh postgres/2026/11/01-0300.dump    återställer den backupen
#
# Stoppar API och fetcher under återställningen.
set -euo pipefail

NS=riftstats
POD=r2-cli
KEY="${1:-}"
MAINTENANCE=0

# En tillfällig pod med aws-cli och uppgifterna från secreten r2-credentials.
start_cli_pod() {
  kubectl apply -n "$NS" -f - >/dev/null <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: $POD
spec:
  restartPolicy: Never
  containers:
    - name: aws
      image: amazon/aws-cli:2.17.0
      command: ["sleep", "900"]
      envFrom:
        - secretRef:
            name: r2-credentials
      env:
        - name: AWS_DEFAULT_REGION
          value: auto
EOF
  kubectl wait -n "$NS" --for=condition=Ready "pod/$POD" --timeout=120s >/dev/null
}

stop_cli_pod() {
  kubectl delete pod -n "$NS" "$POD" --wait=false >/dev/null 2>&1 || true
}
cleanup() {
  status=$?
  stop_cli_pod
  if [[ "$status" != 0 && "$MAINTENANCE" == 1 ]]; then
    echo "Restore misslyckades. Kontrollera databasen innan API och fetcher startas igen." >&2
    echo "Tidigare replikor: api=$API_REPLICAS, fetcher=${FETCHER_REPLICAS:-saknas}" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

aws_cli() {
  # Object keys are positional arguments, never interpolated into shell code.
  kubectl exec -n "$NS" "$POD" -- sh -c "$1" sh "${@:2}"
}

start_cli_pod

if [[ -z "$KEY" ]]; then
  echo "Tillgängliga backuper:"
  aws_cli 'aws s3 ls "s3://$S3_BUCKET/postgres/" --recursive --endpoint-url "$S3_ENDPOINT"'
  echo
  echo "Återställ med: $0 <sökväg, t.ex. postgres/2026/11/01-0300.dump>"
  exit 0
fi

read -r -p "Detta skriver över databasen med $KEY. Fortsätt? [ja/nej] " svar
[[ "$svar" == "ja" ]] || { echo "Avbrutet."; exit 1; }

API_REPLICAS=$(kubectl get deployment api -n "$NS" -o jsonpath='{.spec.replicas}')
FETCHER_REPLICAS=$(kubectl get deployment fetcher -n "$NS" --ignore-not-found -o jsonpath='{.spec.replicas}')
MAINTENANCE=1
echo "Stoppar API och fetcher..."
if [[ -n "$FETCHER_REPLICAS" ]]; then
  kubectl scale deployment fetcher -n "$NS" --replicas=0
fi
# HPA with minReplicas > 0 leaves an explicitly zeroed workload inactive.
kubectl scale deployment api -n "$NS" --replicas=0
kubectl wait -n "$NS" --for=delete pod -l 'app in (api,fetcher)' --timeout=120s

echo "Hämtar $KEY och återställer..."
aws_cli 'aws s3 cp "s3://$S3_BUCKET/$1" - --endpoint-url "$S3_ENDPOINT"' "$KEY" \
  | kubectl exec -i -n "$NS" postgres-0 -- \
      pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error -U riftstats -d riftstats

echo "Återställer antal API- och fetcher-podar..."
kubectl scale deployment api -n "$NS" --replicas="$API_REPLICAS"
if [[ -n "$FETCHER_REPLICAS" ]]; then
  kubectl scale deployment fetcher -n "$NS" --replicas="$FETCHER_REPLICAS"
fi
MAINTENANCE=0

echo "Klart."
