# Mega Açaí — Sistema Financeiro Seguro e Responsivo

Instruções de configuração e deploy estão no documento principal. Copie `.env.example` para `.env` e preencha com as chaves do Supabase.

SQL para criar tabela `sales` e policy (cole no SQL Editor do Supabase):

```sql
create extension if not exists "uuid-ossp";

create table public.sales (
  id uuid default uuid_generate_v4() primary key,
  amount numeric(10,2) not null,
  source text not null,
  payment_method text not null,
  sale_date timestamptz not null default now(),
  created_at timestamptz default now()
);

alter table public.sales enable row level security;

create policy "authenticated_full_access"
  on public.sales
  for all
  to authenticated
  using (true)
  with check (true);
```
