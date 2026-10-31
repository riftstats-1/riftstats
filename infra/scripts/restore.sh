#!/usr/bin/env bash
# Återställ databasen från en backup i R2. Körs på servern.
#
#   ./restore.sh                                  visar alla backuper
#   ./restore.sh postgres/2026/11/01-0300.dump    återställer den backupen
#
# Skalar ner API:t under återställningen så att inget skriver till databasen samtidigt.
set -euo pipefail

NS=riftstats
POD=r2-cli
KEY="${1:-}"

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
trap stop_cli_pod EXIT

aws_cli() {
  kubectl exec -n "$NS" "$POD" -- sh -c "$1"
}

start_cli_pod

if [[ -z "$KEY" ]]; then
  echo "Tillgängliga backuper:"
  aws_cli 'aws s3 ls s3://$S3_BUCKET/postgres/ --recursive --endpoint-url $S3_ENDPOINT'
  echo
  echo "Återställ med: $0 <sökväg, t.ex. postgres/2026/11/01-0300.dump>"
  exit 0
fi

read -r -p "Detta skriver över databasen med $KEY. Fortsätt? [ja/nej] " svar
[[ "$svar" == "ja" ]] || { echo "Avbrutet."; exit 1; }

API_REPLICAS=$(kubectl get deployment api -n "$NS" -o jsonpath='{.spec.replicas}')
echo "Skalar ner API:t (var $API_REPLICAS podar)..."
kubectl scale deployment api -n "$NS" --replicas=0

echo "Hämtar $KEY och återställer..."
aws_cli "aws s3 cp s3://\$S3_BUCKET/$KEY - --endpoint-url \$S3_ENDPOINT" \
  | kubectl exec -i -n "$NS" postgres-0 -- \
      pg_restore --clean --if-exists --no-owner -U riftstats -d riftstats

echo "Skalar upp API:t igen..."
kubectl scale deployment api -n "$NS" --replicas="$API_REPLICAS"

echo "Klart."
