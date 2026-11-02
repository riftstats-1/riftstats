"""Exercise deployment/restore failure paths without SSH, Kubernetes or R2 access."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASH = str(Path("C:/Program Files/Git/bin/bash.exe")) if os.name == "nt" else shutil.which("bash")


class ScriptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="riftstats-infra-test-")
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.log = self.directory / "commands.log"
        self.env = {
            **os.environ,
            "PATH": str(self.directory) + os.pathsep + os.environ["PATH"],
            "LOG": self.log.as_posix(),
            "SCENARIO": "success",
            "S3_BUCKET": "test-bucket",
            "S3_ENDPOINT": "https://r2.test.invalid",
        }

    def stub(self, name, body):
        path = self.directory / name
        path.write_text("#!/usr/bin/env bash\nset -eu\n" + body, encoding="utf-8", newline="\n")
        path.chmod(0o700)

    def run_script(self, name, *args, input="ja\n"):
        command = [BASH, "--noprofile", "--norc"]
        if os.name == "nt":
            # Git Bash prepends its own binaries during Windows startup.
            command += ["-c", 'export PATH="$(cygpath -u "$1"):$PATH"; shift; exec bash "$@"',
                        "test-harness", str(self.directory)]
        command += [str(ROOT / "infra/scripts" / name), *args]
        result = subprocess.run(
            command, input=input.encode(), capture_output=True, env=self.env, cwd=ROOT, timeout=15,
        )
        self.output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
        self.commands = self.log.read_text(encoding="utf-8") if self.log.exists() else ""
        return result.returncode

    def deploy_stubs(self):
        self.stub("ssh", r'''
command="${!#}"
printf '%s\n' "$command" >> "$LOG"
case "$command" in
  *'get secret'*) [[ "$SCENARIO" != missing_secret ]] ;;
  *'get deployment api '*)
    if [[ "$SCENARIO" == missing_revision ]]; then printf 'api='; else printf 'api=7'; fi ;;
  *'get deployment fetcher '*)
    if [[ "$SCENARIO" != first_fetcher ]]; then printf 'fetcher=3'; fi ;;
  *'apply -f -'*) cat >/dev/null; [[ "$SCENARIO" != apply_failure ]] ;;
  *'set -e'*'rollout status deployment/fetcher'*) [[ "$SCENARIO" != first_fetcher ]] ;;
  *) exit 0 ;;
esac
''')
        self.stub("curl", r'''
printf 'curl %s\n' "$*" >> "$LOG"
[[ "$SCENARIO" != smoke_failure ]]
''')

    def deploy(self, scenario):
        self.deploy_stubs()
        self.env["SCENARIO"] = scenario
        return self.run_script("deploy.sh", "deploy@test.invalid", "ghcr.io/riftstats-1/riftstats-api:test", "https://api.test.invalid")

    def test_success_checks_both_roles_and_database_readiness(self):
        self.assertEqual(self.deploy("success"), 0, self.output)
        self.assertIn("rollout status deployment/api", self.commands)
        self.assertIn("rollout status deployment/fetcher", self.commands)
        self.assertIn("https://api.test.invalid/ready", self.commands)
        self.assertNotIn("rollout undo", self.commands)

    def test_missing_secret_does_not_apply_or_rollback(self):
        self.assertNotEqual(self.deploy("missing_secret"), 0)
        self.assertNotIn("apply -f", self.commands)
        self.assertNotIn("rollout undo", self.commands)

    def test_missing_revision_does_not_apply_or_delete_existing_workloads(self):
        self.assertNotEqual(self.deploy("missing_revision"), 0)
        self.assertNotIn("apply -f", self.commands)
        self.assertNotIn("delete deployment", self.commands)

    def test_partial_apply_restores_exact_previous_revisions(self):
        self.assertNotEqual(self.deploy("apply_failure"), 0)
        self.assertIn("rollout undo deployment/api --to-revision=7", self.commands)
        self.assertIn("rollout undo deployment/fetcher --to-revision=3", self.commands)

    def test_first_fetcher_failure_removes_new_worker_and_restores_api(self):
        self.assertNotEqual(self.deploy("first_fetcher"), 0)
        self.assertIn("delete deployment fetcher", self.commands)
        self.assertNotIn("rollout undo deployment/fetcher", self.commands)
        self.assertIn("rollout undo deployment/api --to-revision=7", self.commands)

    def test_readiness_failure_rolls_back_both_roles(self):
        self.assertNotEqual(self.deploy("smoke_failure"), 0)
        self.assertIn("rollout undo deployment/api --to-revision=7", self.commands)
        self.assertIn("rollout undo deployment/fetcher --to-revision=3", self.commands)

    def restore_stubs(self):
        self.stub("kubectl", r'''
printf 'kubectl %s\n' "$*" >> "$LOG"
case "$*" in
  *'get deployment api '*) printf '4' ;;
  *'get deployment fetcher '*) if [[ "$SCENARIO" != no_fetcher ]]; then printf '1'; fi ;;
  'apply '*) cat >/dev/null ;;
  'exec '*)
    while [[ "$1" != -- ]]; do shift; done
    shift
    "$@" ;;
  *) exit 0 ;;
esac
''')
        self.stub("aws", r'''
printf 'aws %s\n' "$*" >> "$LOG"
printf 'fake archive\n'
''')
        self.stub("pg_restore", r'''
printf 'pg_restore %s\n' "$*" >> "$LOG"
cat >/dev/null
[[ "$SCENARIO" != restore_failure ]]
''')

    def restore(self, scenario="success", key="postgres/2026/11/02-0200.dump", input="ja\n"):
        self.restore_stubs()
        self.env["SCENARIO"] = scenario
        return self.run_script("restore.sh", *([key] if key else []), input=input)

    def test_restore_stops_both_roles_and_waits_before_writing(self):
        self.assertEqual(self.restore(), 0, self.output)
        stop_worker = self.commands.index("scale deployment fetcher -n riftstats --replicas=0")
        stop_api = self.commands.index("scale deployment api -n riftstats --replicas=0")
        wait = self.commands.index("--for=delete pod")
        restore = self.commands.index("pg_restore --clean")
        resume_api = self.commands.index("scale deployment api -n riftstats --replicas=4")
        resume_worker = self.commands.index("scale deployment fetcher -n riftstats --replicas=1")
        self.assertLess(stop_worker, wait)
        self.assertLess(stop_api, wait)
        self.assertLess(wait, restore)
        self.assertLess(restore, resume_api)
        self.assertLess(restore, resume_worker)
        self.assertIn("--single-transaction --exit-on-error", self.commands)

    def test_restore_failure_leaves_workloads_stopped(self):
        self.assertNotEqual(self.restore("restore_failure"), 0)
        self.assertNotIn("--replicas=4", self.commands)
        self.assertNotIn("--replicas=1", self.commands)
        self.assertIn("delete pod", self.commands)

    def test_restore_supports_cluster_without_fetcher(self):
        self.assertEqual(self.restore("no_fetcher"), 0, self.output)
        self.assertNotIn("scale deployment fetcher", self.commands)

    def test_listing_or_declining_does_not_stop_workloads(self):
        self.assertEqual(self.restore(key=""), 0, self.output)
        self.assertNotIn("scale deployment", self.commands)
        self.assertNotEqual(self.restore(input="nej\n"), 0)
        self.assertNotIn("scale deployment", self.commands)

    def test_backup_key_is_data_not_shell_code(self):
        sentinel = self.directory / "must-not-exist"
        key = f"postgres/backup.dump; touch {sentinel.as_posix()}"
        self.assertEqual(self.restore(key=key), 0, self.output)
        self.assertFalse(sentinel.exists())
        self.assertIn(key, self.commands)


if __name__ == "__main__":
    unittest.main()
