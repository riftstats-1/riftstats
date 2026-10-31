# Monitoring: Prometheus, Grafana och Loki

Mål: en dashboard på **https://grafana.riftstats.se** som visar metrics (CPU, minne, antal podar,
requests) och loggar från alla tjänster. Det ska visas på det muntliga försvaret.

| Komponent | Vad den gör | Fil |
|---|---|---|
| Prometheus | Samlar in och lagrar metrics (siffror över tid) | `kube-prometheus-stack.yaml` |
| Grafana | Visar metrics och loggar i dashboards | `kube-prometheus-stack.yaml` |
| node-exporter, kube-state-metrics | Metrics om servern och klustret (CPU, minne, podar, HPA) | ingår i stacken |
| Loki | Lagrar loggar | `loki.yaml` |
| Alloy | Läser loggarna från alla podar och skickar till Loki | `alloy.yaml` |

```
podar (stdout) ──> Alloy ──> Loki ──┐
                                    ├──> Grafana ──> grafana.riftstats.se
server, kluster ──> Prometheus ─────┘
```

Retention är 5 dagar för både metrics och loggar, så att disken inte fylls.

---

## 1. Förbered (på servern)

Logga in på servern och hämta repot:

```bash
cd ~
git clone https://github.com/riftstats-1/riftstats.git   # eller: cd riftstats && git pull
cd riftstats
```

Lägg till Helm-repona:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
```

Skapa namespace och Grafanas admin-lösenord:

```bash
kubectl create namespace monitoring

kubectl create secret generic grafana-admin -n monitoring \
  --from-literal=admin-user=admin \
  --from-literal=admin-password="$(openssl rand -base64 18)"
```

Visa lösenordet (spara det i en lösenordshanterare och dela det privat med gruppen, aldrig i repot):

```bash
kubectl get secret grafana-admin -n monitoring -o jsonpath='{.data.admin-password}' | base64 -d; echo
```

## 2. Installera

En i taget, i den här ordningen. Varje kommando tar en minut eller två.

```bash
helm upgrade --install loki grafana/loki \
  -n monitoring -f infra/monitoring/loki.yaml

helm upgrade --install alloy grafana/alloy \
  -n monitoring -f infra/monitoring/alloy.yaml

helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring -f infra/monitoring/kube-prometheus-stack.yaml
```

Följ podarna tills alla är `Running` (avsluta med `Ctrl+C`):

```bash
kubectl get pods -n monitoring -w
```

Kolla att Grafana fått sitt certifikat:

```bash
kubectl get certificate -n monitoring
```

## 3. Testa

1. Öppna **https://grafana.riftstats.se** och logga in med `admin` och lösenordet.
2. **Metrics:** Dashboards → leta upp **Kubernetes / Compute Resources / Namespace (Pods)**,
   välj namespace `riftstats`. Du ska se CPU och minne för `api`-podarna och `postgres-0`.
3. **Loggar:** Explore → välj datakällan **Loki** → skriv frågan `{namespace="riftstats"}` → Run query.
   Du ska se loggar från API:t.

## 4. Nästa steg: egen dashboard "RiftStats overview"

Bygg en dashboard med paneler för det vi ska visa på försvaret. Bra PromQL-frågor att börja med:

| Panel | Fråga |
|---|---|
| Antal API-podar (visar autoscaling) | `kube_deployment_status_replicas_available{namespace="riftstats", deployment="api"}` |
| HPA: önskat antal podar | `kube_horizontalpodautoscaler_status_desired_replicas{namespace="riftstats"}` |
| CPU per pod | `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="riftstats", container!=""}[2m]))` |
| Minne per pod | `sum by (pod) (container_memory_working_set_bytes{namespace="riftstats", container!=""})` |
| Pod-omstarter | `sum by (pod) (kube_pod_container_status_restarts_total{namespace="riftstats"})` |
| Senaste lyckade backup | `kube_cronjob_status_last_successful_time{namespace="riftstats", cronjob="pg-backup"}` (visa som "time ago") |
| Loggar från API:t | Loki: `{namespace="riftstats", app="api"}` |

När dashboarden är klar: **Share → Export → Save to file** och lägg JSON-filen i
`infra/monitoring/dashboards/overview.json`, så att den finns i repot.

Senare lägger vi till request-metrics från API:t (requests per sekund, latens, felfrekvens) via
`/metrics` i Fastify och en ServiceMonitor.

## Felsökning

| Problem | Kolla |
|---|---|
| Pod hänger i `Pending` | `kubectl describe pod <namn> -n monitoring` (ofta disk eller minne) |
| Pod i `CrashLoopBackOff` | `kubectl logs <namn> -n monitoring` |
| Grafana-sidan laddar inte | `kubectl get ingress,certificate -n monitoring` |
| Inga loggar i Loki | `kubectl logs -n monitoring deploy/alloy` |
| Minne och disk | `free -h` och `df -h /` på servern |

Ta bort allt och börja om: `helm uninstall monitoring alloy loki -n monitoring`
