alter table tenants add column if not exists custom_domain text unique;
comment on column tenants.custom_domain is
  'Hostname that resolves to this tenant via middleware (e.g. vikas.bpmsquare.com). Null = no dedicated domain, reachable only via app.bpmsquare.com login.';
