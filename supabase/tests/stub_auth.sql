-- Minimal stand-in for Supabase auth, so migrations and scenario.sql run on plain Postgres.
create role authenticated nologin;
create role anon nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), phone text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon;
alter default privileges in schema public grant all on tables to authenticated, anon;
