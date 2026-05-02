-- Execute este arquivo no Supabase em SQL Editor para liberar o sistema.
-- Versao simples para o app funcionar direto no navegador com a chave anon.
-- Observacao: para producao, o ideal e migrar para Supabase Auth + RLS por usuario.

alter table oficinas disable row level security;
alter table usuarios disable row level security;
alter table clientes disable row level security;
alter table ordens_servico disable row level security;

insert into usuarios (email, senha, tipo, oficina_id)
values ('admin@oficina.com', '123456', 'master', null)
on conflict do nothing;
