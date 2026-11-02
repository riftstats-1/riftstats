#!/usr/bin/env bash
# Runs on the CI runner after SSH setup. No Riot calls or schema rollback.
set -euo pipefail

TARGET="${1:?Usage: deploy.sh user@host image https://api-host}"
IMAGE="${2:?Image is required}"
API_URL="${3:?API URL is required}"
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
[[ "$TARGET" != -* && "$TARGET" != *[[:space:]]* && "$TARGET" == *@* ]] || exit 1
[[ "$IMAGE" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$ && "$API_URL" == https://* ]] || exit 1

remote() {
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$TARGET" "export KUBECONFIG=\$HOME/.kube/config; $1"
}

# Fail before changing deployments if required secret fields are absent.
remote 'set -e
  test -n "$(kubectl -n riftstats get secret postgres-credentials -o jsonpath="{.data.password}")"
  test -n "$(kubectl -n riftstats get secret riot-api-key -o jsonpath="{.data.key}")"'

declare -A previous
for role in api fetcher; do
  state=$(remote "kubectl -n riftstats get deployment $role --ignore-not-found -o 'jsonpath={.metadata.name}={.metadata.annotations.deployment\.kubernetes\.io/revision}'")
  if [[ -z "$state" ]]; then
    previous[$role]=absent
  else
    revision=${state#*=}
    [[ "$state" == "$role="* && "$revision" =~ ^[0-9]+$ ]] || { echo "Cannot record $role revision" >&2; exit 1; }
    previous[$role]=$revision
  fi
done

failed_deploy() {
  echo "Deployment failed; collecting diagnostics and restoring previous revisions." >&2
  remote 'kubectl -n riftstats get pods -o wide' || true
  for role in api fetcher; do
    remote "kubectl -n riftstats logs -l app=$role --tail=50 --prefix=true" || true
  done
  for role in fetcher api; do
    if [[ "${previous[$role]}" == absent ]]; then
      remote "kubectl -n riftstats delete deployment $role --ignore-not-found --timeout=120s" || echo "Could not remove new $role deployment" >&2
    else
      remote "kubectl -n riftstats rollout undo deployment/$role --to-revision=${previous[$role]}" || echo "Could not roll back $role" >&2
    fi
  done
  for role in api fetcher; do
    if [[ "${previous[$role]}" != absent ]]; then
      remote "kubectl -n riftstats rollout status deployment/$role --timeout=300s" || echo "$role rollback is not ready" >&2
    fi
  done
  exit 1
}

render_manifests() {
  sed "s|IMAGE_PLACEHOLDER|$IMAGE|g" "$ROOT/infra/k8s/api.yaml" || return
  printf '\n---\n'
  cat "$ROOT/infra/k8s/postgres.yaml" || return
  printf '\n---\n'
  cat "$ROOT/infra/k8s/backup.yaml"
}

if ! render_manifests | remote 'kubectl apply -f -'; then failed_deploy; fi
if ! remote 'set -e
  kubectl -n riftstats rollout status deployment/api --timeout=300s
  kubectl -n riftstats rollout status deployment/fetcher --timeout=300s'; then failed_deploy; fi
if ! curl --fail --silent --show-error --connect-timeout 5 --max-time 15 --retry 5 --retry-delay 3 --retry-all-errors "$API_URL/ready"; then failed_deploy; fi
echo "API and fetcher deployed successfully."
