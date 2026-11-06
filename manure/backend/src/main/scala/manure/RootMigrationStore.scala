package manure

import java.sql.Connection

final case class StoredRootMigration(plan: RootMigrationPlan,status: String)

object RootMigrationStore:
  private val FunctionBody="""BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'immutable-root-migration' USING ERRCODE='23514'; END IF;
    IF OLD.status <> 'pending' OR NEW.status <> 'applied' OR
      ROW(NEW.singleton,NEW.plan_hash,NEW.legacy,NEW.portable,NEW.plan,NEW.created_at) IS DISTINCT FROM
      ROW(OLD.singleton,OLD.plan_hash,OLD.legacy,OLD.portable,OLD.plan,OLD.created_at)
    THEN RAISE EXCEPTION 'immutable-root-migration' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END"""
  private val Schema=s"""CREATE TABLE manure.root_identity_migrations(
    singleton boolean PRIMARY KEY CHECK(singleton),plan_hash text UNIQUE NOT NULL CHECK(plan_hash ~ '^[0-9a-f]{64}$$'),
    legacy bytea NOT NULL CHECK(octet_length(legacy)=16),portable bytea NOT NULL CHECK(octet_length(portable)=76),
    plan bytea NOT NULL CHECK(octet_length(plan) BETWEEN 1 AND 32768),
    status text NOT NULL CHECK(status IN ('pending','applied')),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE FUNCTION manure.manure_root_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$guard$$$FunctionBody$$guard$$;
    CREATE TRIGGER manure_root_identity_immutable BEFORE UPDATE OR DELETE ON manure.root_identity_migrations
      FOR EACH ROW EXECUTE FUNCTION manure.manure_root_identity_immutable();"""
  def database(config: Config,c: Connection): RootMigrationDatabase =
    Jdbc.rows(c,"SELECT current_database(),oid::bigint FROM pg_database WHERE datname=current_database()") { row =>
      RootMigrationDatabase(config.database.jdbcUrl,config.database.user,row.getString(1),row.getLong(2))
    }.head
  def noOtherClients(c: Connection): Unit =
    Require(Jdbc.rows(c,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")(_.getLong(1)).head == 0,"migration-active-clients")
  def binding(c: Connection): Array[Byte] =
    Require(Jdbc.rows(c,"SELECT to_regclass('manure.root_owner') IS NOT NULL")(_.getBoolean(1)).head,"migration-required")
    val rows=Jdbc.rows(c,"SELECT identity FROM manure.root_owner WHERE singleton")(_.getBytes(1))
    Require(rows.size == 1,"migration-required");rows.head
  def destination(c: Connection): Option[ImportedDestination] =
    if Jdbc.rows(c,"SELECT to_regclass('manure_offline.destination') IS NOT NULL")(_.getBoolean(1)).head then
      val rows=Jdbc.rows(c,"SELECT id,root,source,writes_started FROM manure_offline.destination") { row =>
        ImportedDestination(row.getString(1),row.getString(2),Option(row.getString(3)).getOrElse(""),row.getBoolean(4))
      }
      Require(rows.size == 1,"migration-required");Some(rows.head)
    else None
  private def exists(c: Connection): Boolean =
    Jdbc.rows(c,"SELECT to_regclass('manure.root_identity_migrations') IS NOT NULL")(_.getBoolean(1)).head
  private def validateSchema(c: Connection): Unit =
    Require(Jdbc.rows(c,"""SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid='manure.root_identity_migrations'::regclass
      AND NOT t.tgisinternal AND t.tgname='manure_root_identity_immutable' AND t.tgtype=27 AND t.tgenabled='O'
      AND n.nspname='manure' AND p.proname='manure_root_identity_immutable' AND p.prosrc=?""",FunctionBody)(_.getLong(1)).head == 1,"migration-receipt-invalid")
  def read(c: Connection): Option[StoredRootMigration] =
    if !exists(c) then None
    else
      validateSchema(c)
      val rows=Jdbc.rows(c,"SELECT plan_hash,legacy,portable,plan,status FROM manure.root_identity_migrations WHERE singleton") { row =>
        val bytes=row.getBytes(4)
        Require(bytes.length <= RootMigrationPlan.MaximumBytes,"migration-receipt-invalid")
        val plan=RootMigrationPlan.decode(CurrentWire.parse(Exact.string(bytes)))
        Require(plan.sha256 == row.getString(1) && java.util.Arrays.equals(bytes,plan.bytes) &&
          java.util.Arrays.equals(plan.legacy.bytes,row.getBytes(2)) && java.util.Arrays.equals(plan.portable.bytes,row.getBytes(3)),"migration-receipt-invalid")
        val status=row.getString(5);Require(Set("pending","applied")(status),"migration-receipt-invalid")
        StoredRootMigration(plan,status)
      }
      Require(rows.size <= 1,"migration-receipt-invalid");rows.headOption
  def begin(c: Connection,plan: RootMigrationPlan): Unit =
    if !exists(c) then Jdbc.exec(c,Schema)
    validateSchema(c)
    Require(Jdbc.rows(c,"INSERT INTO manure.root_identity_migrations(singleton,plan_hash,legacy,portable,plan,status) VALUES(true,?,?,?,?, 'pending') RETURNING true",
      plan.sha256,plan.legacy.bytes,plan.portable.bytes,plan.bytes)(_.getBoolean(1)).size == 1,"migration-receipt-invalid")
  def finish(c: Connection,plan: RootMigrationPlan): Unit =
    Require(Jdbc.rows(c,"UPDATE manure.root_owner SET identity=? WHERE singleton AND identity=? RETURNING true",plan.portable.bytes,plan.legacy.bytes)(_.getBoolean(1)).size == 1,"migration-plan-stale")
    Require(Jdbc.rows(c,"UPDATE manure.root_identity_migrations SET status='applied' WHERE singleton AND plan_hash=? AND status='pending' RETURNING true",plan.sha256)(_.getBoolean(1)).size == 1,"migration-receipt-invalid")
