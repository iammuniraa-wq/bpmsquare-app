-- Recover ONE deleted employee (and everything recorded against them) from a backup, without touching anyone else.
--
-- Why this works: deleting an employee cascades to their punches, corrections, leave and overtime rows. A backup taken
-- before the delete still has all of it. We never restore over production. We restore the backup into a SEPARATE scratch
-- project, run this file THERE to get a block of INSERT statements for this one person, then run that block in
-- production. Every statement is "insert ... on conflict do nothing", so running it twice, or for rows that already exist,
-- changes nothing.
--
-- STEP 1  Supabase dashboard > Database > Backups: pick the newest backup from BEFORE the delete and use
--         "Restore to a new project" (point-in-time restore if the plan has it). Production is not touched.
-- STEP 2  In the NEW project's SQL editor: select all (Ctrl+A) and run this whole file, after editing the two values in
--         the last statement (the person's name, the workspace id).
-- STEP 3  The result is one column of text. Copy ALL of it into PRODUCTION's SQL editor (Ctrl+A, run).
-- STEP 4  Open the employee in the app: the person is back with their recorded time. Delete the scratch project.
--
-- Rows recorded after the backup was taken are not in it; the only loss is that gap.
-- Read-only on production except the generated inserts. Safe to re-run.

create or replace function public.recover_employee_sql(p_first text, p_last text, p_tenant uuid)
returns text
language plpgsql
as $$
declare
  emp record;
  fk record;
  j text;
  out_sql text := '';
begin
  select * into emp from public.employees
   where tenant_id = p_tenant and lower(first_name) = lower(p_first) and lower(last_name) = lower(p_last);
  if not found then
    return '-- No employee called ' || p_first || ' ' || p_last || ' in this backup for that workspace. Check the spelling, or use an older backup.';
  end if;

  -- The person first (same id, so everything below re-attaches to them).
  out_sql := out_sql || format(E'insert into public.employees select * from jsonb_populate_recordset(null::public.employees, %L::jsonb) on conflict (id) do nothing;\n',
    jsonb_build_array(to_jsonb(emp))::text);

  -- Their login link: deleting the employee set it to null, it is put back only where it is still empty.
  for j in select jsonb_agg(jsonb_build_object('user_id', user_id)) :: text from public.tenant_users where employee_id = emp.id and tenant_id = p_tenant loop
    if j is not null then
      out_sql := out_sql || format(E'update public.tenant_users t set employee_id = %L where t.tenant_id = %L and t.employee_id is null and t.user_id in (select (x->>''user_id'')::uuid from jsonb_array_elements(%L::jsonb) x);\n',
        emp.id, p_tenant, j);
    end if;
  end loop;

  -- Every table that points at employees (found from the foreign keys, so a table added later is covered too).
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.employees'::regclass and c.conrelid <> 'public.employees'::regclass
     order by 1, 2
  loop
    execute format('select jsonb_agg(to_jsonb(x))::text from %s x where x.%I = %L', fk.tbl, fk.col, emp.id) into j;
    if j is not null then
      out_sql := out_sql || format(E'-- %s.%s\ninsert into %s select * from jsonb_populate_recordset(null::%s, %L::jsonb) on conflict do nothing;\n',
        fk.tbl, fk.col, fk.tbl, fk.tbl, j);
    end if;
  end loop;

  return out_sql;
end;
$$;

-- EDIT the three values: first name, last name (as in Employees), and the workspace id (tenants.id of BIM).
select public.recover_employee_sql('FIRST NAME', 'LAST NAME', '00000000-0000-0000-0000-000000000000'::uuid) as run_this_in_production;
