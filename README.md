# Lumi no celular

App web instalável (PWA) da assistente Lumi. Mostra e edita as mesmas tarefas, lembretes,
hábitos e notas do app do PC, sincronizados pelo Supabase, com chat, notificações e feed de calendário.

- Login: conta do Supabase (os dados são protegidos por RLS; a chave neste código é a pública).
- Chat: função `lumi-chat` (Claude) no Supabase — funciona com o PC desligado.
- Notificações: Web Push pela função `lumi-push` (agendada a cada minuto).
- Calendário: feed ICS pela função `lumi-ics`.

O código das funções e do app do PC fica no projeto Lumi (não publicado).
