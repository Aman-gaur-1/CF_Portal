-- Preserve confirmed canonical reconciliation evidence when a student's
-- historical reconciliation.batch is stale after a batch transfer. The
-- reconciliation row is not rewritten; only the scoring projection uses the
-- student's current active batch for ranking and Health Card aggregation.

BEGIN;

DO $$
DECLARE
  v_definition text;
  v_join text := E'JOIN active_students bs\n      ON bs.id = r.student_id\n     AND bs.batch = r.batch';
  v_select text := E'      r.batch,\n      cc.item_id,\n      cc.item_type,\n      COALESCE(r.confirmed_at, r.updated_at, r.created_at)';
BEGIN
  SELECT pg_get_functiondef('public.cf_health_card_leaderboard_scored_base(text,date)'::regprocedure)
    INTO v_definition;

  IF position(v_join IN v_definition) > 0 AND position(v_select IN v_definition) > 0 THEN
    v_definition := replace(v_definition, v_join, E'JOIN active_students bs\n      ON bs.id = r.student_id');
    v_definition := replace(v_definition, v_select, E'      bs.batch,\n      cc.item_id,\n      cc.item_type,\n      COALESCE(r.confirmed_at, r.updated_at, r.created_at)');
    EXECUTE v_definition;
  ELSIF position(E'      bs.batch,\n      cc.item_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unified coursework leaderboard function is not at the expected migration version';
  END IF;
END;
$$;

COMMIT;
