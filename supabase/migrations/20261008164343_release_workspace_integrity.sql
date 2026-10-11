-- Preserve legacy roles/statuses while accepting the choices already offered by the app.
ALTER TABLE public.workspace_members DROP CONSTRAINT workspace_members_role_check;
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('owner','admin','manager','member','technician','viewer'));
ALTER TABLE public.repairs DROP CONSTRAINT repairs_status_check;
ALTER TABLE public.repairs ADD CONSTRAINT repairs_status_check
  CHECK (status IN ('open','waiting_parts','in_progress','completed','cancelled'));

-- Team mutations must use the existing authenticated, authorization-checked RPCs.
-- Direct writes could promote members or create an owner invitation.
REVOKE INSERT, UPDATE, DELETE ON public.workspace_members, public.workspace_invites
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_workspace_change() FROM PUBLIC, anon, authenticated;

-- Existing single-column cascading foreign keys are retained. These additional
-- constraints enforce workspace consistency, including privileged backend writes.
ALTER TABLE public.assets ADD CONSTRAINT assets_id_workspace_unique UNIQUE (id, workspace_id);
ALTER TABLE public.maintenance_schedules ADD CONSTRAINT schedules_asset_workspace_unique
  UNIQUE (id, asset_id, workspace_id);
DO $migration$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['maintenance_records','repairs','expenses','maintenance_schedules','downtime_events']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (asset_id,workspace_id) REFERENCES public.assets(id,workspace_id)',
      table_name, table_name || '_asset_workspace_fkey');
  END LOOP;
END;
$migration$;
ALTER TABLE public.maintenance_records ADD CONSTRAINT maintenance_records_schedule_workspace_fkey
  FOREIGN KEY (schedule_id, asset_id, workspace_id)
  REFERENCES public.maintenance_schedules(id, asset_id, workspace_id);

-- An owner cannot be demoted by another owner through the role-edit RPC.
CREATE OR REPLACE FUNCTION public.set_workspace_member_role(target_workspace uuid, target_user uuid, target_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private', 'auth'
AS $function$
BEGIN
  IF NOT private.has_workspace_role(target_workspace, ARRAY['owner']) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF target_user=auth.uid() THEN RAISE EXCEPTION 'Owner cannot change their own role here'; END IF;
  IF target_role NOT IN ('manager','technician','viewer') OR target_role IS NULL THEN RAISE EXCEPTION 'Invalid role'; END IF;
  IF EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=target_workspace AND user_id=target_user AND role='owner')
    THEN RAISE EXCEPTION 'Owner role cannot be changed here'; END IF;
  UPDATE public.workspace_members SET role=target_role WHERE workspace_id=target_workspace AND user_id=target_user;
END;
$function$;

-- Acceptance is serialized, never accepts an owner invitation, and never changes
-- an existing member's role (role changes belong to the owner-only RPC).
CREATE OR REPLACE FUNCTION public.accept_workspace_invite(invite_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private', 'auth'
AS $function$
DECLARE v_invite public.workspace_invites%ROWTYPE; v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_email := lower(coalesce(auth.jwt()->>'email',''));
  SELECT * INTO v_invite FROM public.workspace_invites
    WHERE token=invite_token AND status='pending' LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invite not found or no longer active'; END IF;
  IF lower(v_invite.email)<>v_email OR v_email='' THEN RAISE EXCEPTION 'This invite belongs to a different email address'; END IF;
  IF v_invite.role NOT IN ('manager','technician','viewer') THEN RAISE EXCEPTION 'Invalid invite role'; END IF;
  INSERT INTO public.workspace_members(workspace_id,user_id,role)
    VALUES(v_invite.workspace_id,auth.uid(),v_invite.role) ON CONFLICT (workspace_id,user_id) DO NOTHING;
  UPDATE public.workspace_invites SET status='accepted',accepted_at=now() WHERE id=v_invite.id;
  INSERT INTO public.activity_log(workspace_id,actor_user_id,action,entity_type,entity_id,details)
    VALUES(v_invite.workspace_id,auth.uid(),'accepted invite','workspace_member',auth.uid(),jsonb_build_object('role',v_invite.role));
  RETURN v_invite.workspace_id;
END;
$function$;
