-- Allow org admins/PEs to delete project data (used by "Reset demo"); audit rows go via FK cascade.
create policy cap_delete on public.captures for delete to authenticated
  using (private.is_org_member(private.project_org(project_id), array['admin','pe']::public.member_role[]));
create policy mk_delete on public.markups for delete to authenticated
  using (private.is_org_member(private.project_org(project_id), array['admin','pe']::public.member_role[]));
create policy ex_delete on public.exports for delete to authenticated
  using (private.is_org_member(private.project_org(project_id), array['admin','pe']::public.member_role[]));
create policy fab_storage_delete on storage.objects for delete to authenticated
  using (bucket_id in ('drawings','photos','audio','exports')
         and private.is_org_member_path((storage.foldername(name))[1]));
create policy fab_storage_update on storage.objects for update to authenticated
  using (bucket_id in ('drawings','photos','audio','exports')
         and private.is_org_member_path((storage.foldername(name))[1]));
