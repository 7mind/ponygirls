# Sourced by every fixture test of the legacy-retirement scripts (F8): a test must never inherit a connection or a
# deployment target. It refuses to start when any of these is set in the environment, and the test then sets only
# its own local socket. Run the tests from a clean shell (not one prepared for op.sh or a production psql).
for lr_guard_var in PSQL PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE PGPASSWORD PGPASSFILE \
    PGOPTIONS PGSSLMODE KUBECONFIG LR_CONTEXT LR_NAMESPACE LR_POD LR_CONTAINER LR_SOCKET LR_ROLE SOURCE_PG_DUMP; do
  if [ -n "$(eval "printf '%s' \"\${$lr_guard_var+set}\"")" ]; then
    printf 'test refused: %s is set in the environment; run the fixture tests from a clean shell\n' "$lr_guard_var" >&2
    exit 4
  fi
done
unset lr_guard_var
