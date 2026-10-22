-- =============================================================================
-- SIN&AT — Migración 3: catálogo de reglas del motor
--
-- Es configuración del sistema, no dato de prueba: va en migración para que
-- exista en cualquier entorno. El significado de "umbral" depende de la regla:
--   R1  NULL  → usa insumo.dias_alerta_caducidad
--   R2  7     → días del ciclo de pedido (pedido sugerido semanal)
--   R3  80    → % mínimo de cumplimiento del proveedor
--   R4  NULL  → encadenada, no tiene umbral propio
--   R5  2     → factor sobre vida_util_dias
--   R6  NULL  → encadenada, no tiene umbral propio
-- =============================================================================

insert into public.regla (codigo, nombre, tipo, umbral, severidad_base, ventana_supresion_min, activa) values
  ('R1', 'Caducidad próxima',                         'BASE',       null, 'MEDIA', 1440, true),
  ('R2', 'Riesgo de faltante',                        'BASE',       7,    'MEDIA', 1440, true),
  ('R3', 'Proveedor poco confiable',                  'BASE',       80,   'MEDIA', 1440, true),
  ('R4', 'Faltante con proveedor poco confiable',     'ENCADENADA', null, 'ALTA',  720,  true),
  ('R5', 'Sobrestock',                                'BASE',       2,    'BAJA',  1440, true),
  ('R6', 'Sobrecompra: caducidad con sobrestock',     'ENCADENADA', null, 'ALTA',  720,  true)
on conflict (codigo) do nothing;
