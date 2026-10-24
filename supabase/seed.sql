-- =============================================================================
-- SIN&AT — Datos de prueba (Vila Baleia, restaurante de mariscos)
--
-- Todas las fechas son relativas a current_date: el escenario se reproduce
-- igual el día que se cargue.
--
-- 3 proveedores · 15 insumos · 20 lotes · 60 movimientos (20 entradas +
-- 40 consumos/mermas) · 17 entregas · 15 comandas cerradas + 2 abiertas
--
-- Escenarios que deben disparar reglas (se verificarán en el paso 6):
--   R1  Lapas (L3, caduca mañana), Polvo (L4, mañana), Maracujá (L11, +2 días),
--       Natas lote viejo (L16, +3 días)
--   R3  Distribuidora Atlântico: 2 de 5 entregas a tiempo y conformes (40 %)
--   R2  Camarão (≈3 días de cobertura) y Manteiga (≈4 días), ambos de Atlântico
--       (dprox = días hasta el próximo lunes, de 1 a 7: se cumple cualquier día;
--       el pescado fresco, con 3–5 días de cobertura, también puede dar R2
--       según el día de la semana, pero sin R4 porque Peixaria cumple 83 %)
--   R4  ⇒ R2 + R3 sobre Camarão y Manteiga → ALTA, aumentar pedido
--   R5  Natas: 46 l en existencia para un consumo de ≈0,13 l/día (>> 2 × 20 días)
--   R6  ⇒ R1(L16) + R5(Natas) → sobrecompra, reducir próximo pedido
--   R7  Mesa 11, abierta hace 70 min y sin salir de cocina: supera el Uf de
--       almuerzo (≈19 min) y de cena (≈48 min). Sólo se evalúa si el seed se
--       carga dentro de una franja de servicio (almuerzo 12–16, cena 19–23):
--       fuera de servicio no se vigilan tiempos, por diseño.
--
-- Los movimientos y comandas se cargan sin usuario_id (aún no hay usuarios);
-- la app siempre los registrará a nombre de quien opera.
-- =============================================================================

-- Limpieza (no toca regla ni perfil)
truncate table public.alerta, public.hecho, public.movimiento, public.lote,
               public.entrega, public.comanda, public.insumo, public.proveedor
  restart identity cascade;

-- -----------------------------------------------------------------------------
-- Proveedores
-- -----------------------------------------------------------------------------
insert into public.proveedor (id, nombre, lead_time_dias, contacto, activo) values
  (1, 'Peixaria do Porto Moniz',    1, 'Sr. Duarte · +351 291 850 112', true),
  (2, 'Hortofrutícola da Madeira',  2, 'encomendas@hortomadeira.pt',    true),
  (3, 'Distribuidora Atlântico',    4, 'Ana Freitas · +351 291 700 455', true);

-- -----------------------------------------------------------------------------
-- Insumos
--   id, nombre, unidad, categoria, proveedor, dias_alerta_caducidad,
--   vida_util_dias, stock_minimo
-- -----------------------------------------------------------------------------
insert into public.insumo
  (id, nombre, unidad, categoria, proveedor_id, dias_alerta_caducidad, vida_util_dias, stock_minimo) values
  ( 1, 'Peixe-espada preto (filete)', 'kg', 'Pescado y marisco', 1,  1,   3, 4),
  ( 2, 'Lapas',                       'kg', 'Pescado y marisco', 1,  1,   2, 3),
  ( 3, 'Polvo',                       'kg', 'Pescado y marisco', 1,  1,   3, 3),
  ( 4, 'Atum (lombo congelado)',      'kg', 'Pescado y marisco', 1, 15, 120, 3),
  ( 5, 'Camarão congelado',           'kg', 'Pescado y marisco', 3, 30, 180, 3),
  ( 6, 'Batata',                      'kg', 'Frutas y verduras', 2,  5,  30, 15),
  ( 7, 'Cebola',                      'kg', 'Frutas y verduras', 2,  5,  30, 8),
  ( 8, 'Limão',                       'kg', 'Frutas y verduras', 2,  4,  21, 4),
  ( 9, 'Maracujá',                    'kg', 'Frutas y verduras', 2,  3,  10, 2),
  (10, 'Alho',                        'kg', 'Frutas y verduras', 2,  7,  60, 1),
  (11, 'Banana da Madeira',           'kg', 'Frutas y verduras', 2,  2,   7, 3),
  (12, 'Azeite',                      'l',  'Despensa',          3, 30, 365, 5),
  (13, 'Manteiga',                    'kg', 'Lácteos',           3, 10,  60, 2),
  (14, 'Natas',                       'l',  'Lácteos',           3,  5,  20, 4),
  (15, 'Farinha de milho',            'kg', 'Despensa',          3, 20, 180, 5);

-- -----------------------------------------------------------------------------
-- Lotes (cantidad_actual se recalcula al final a partir de los movimientos)
-- -----------------------------------------------------------------------------
insert into public.lote
  (id, insumo_id, proveedor_id, cantidad_inicial, cantidad_actual,
   fecha_recepcion, fecha_caducidad, costo_unitario) values
  ( 1,  1, 1, 28, 28, current_date - 6,  current_date - 3,  14.20),  -- espada, agotado
  ( 2,  1, 1, 10, 10, current_date - 1,  current_date + 2,  14.50),  -- espada, vigente
  ( 3,  2, 1, 10, 10, current_date - 1,  current_date + 1,   9.00),  -- lapas → R1
  ( 4,  3, 1, 11, 11, current_date - 2,  current_date + 1,  12.00),  -- polvo → R1
  ( 5,  4, 1,  6,  6, current_date - 1,  current_date + 119, 16.00),  -- atum
  ( 6,  5, 3, 12, 12, current_date - 25, current_date + 155, 11.00), -- camarão → R2/R4
  ( 7,  6, 2, 25, 25, current_date - 12, current_date + 18,  0.65),  -- batata, casi agotado
  ( 8,  6, 2, 25, 25, current_date - 3,  current_date + 27,  0.65),  -- batata
  ( 9,  7, 2, 15, 15, current_date - 10, current_date + 20,  0.80),  -- cebola
  (10,  8, 2,  6,  6, current_date - 8,  current_date + 13,  1.90),  -- limão
  (11,  9, 2,  4,  4, current_date - 5,  current_date + 2,   4.50),  -- maracujá → R1
  (12, 10, 2,  3,  3, current_date - 20, current_date + 40,  4.00),  -- alho
  (13, 11, 2,  5,  5, current_date - 4,  current_date + 3,   1.60),  -- banana
  (14, 12, 3, 20, 20, current_date - 28, current_date + 337, 6.50),  -- azeite
  (15, 13, 3,  5,  5, current_date - 18, current_date + 42,  7.20),  -- manteiga → R2/R4
  (16, 14, 3, 10, 10, current_date - 16, current_date + 3,   2.80),  -- natas viejo → R1/R6
  (17, 14, 3, 40, 40, current_date - 2,  current_date + 18,  2.60),  -- natas nuevo → R5/R6
  (18, 15, 3, 15, 15, current_date - 22, current_date + 158, 1.20),  -- farinha
  (19,  3, 1, 20, 20, current_date - 9,  current_date - 6,  11.50),  -- polvo, agotado
  (20,  2, 1, 25, 25, current_date - 8,  current_date - 6,   8.80);  -- lapas, se botó parte

select setval(pg_get_serial_sequence('public.proveedor', 'id'), (select max(id) from public.proveedor));
select setval(pg_get_serial_sequence('public.insumo',    'id'), (select max(id) from public.insumo));
select setval(pg_get_serial_sequence('public.lote',      'id'), (select max(id) from public.lote));

-- -----------------------------------------------------------------------------
-- Movimientos — 20 ENTRADA (una por lote, el día de recepción a las 08:30)
-- -----------------------------------------------------------------------------
insert into public.movimiento (insumo_id, lote_id, tipo, cantidad, motivo, fecha, usuario_id)
select l.insumo_id, l.id, 'ENTRADA', l.cantidad_inicial,
       'Recepción de lote', l.fecha_recepcion + time '08:30', null
from public.lote l
order by l.id;

-- -----------------------------------------------------------------------------
-- Movimientos — 40 CONSUMO / MERMA
--   (lote, tipo, cantidad, días atrás, hora, motivo)
-- -----------------------------------------------------------------------------
insert into public.movimiento (insumo_id, lote_id, tipo, cantidad, motivo, fecha, usuario_id)
select l.insumo_id, m.lote_id, m.tipo, m.cantidad, m.motivo,
       (current_date - m.dias) + m.hora, null
from (values
  -- Peixe-espada (L1 agotado, L2 vigente)
  ( 1, 'CONSUMO', 12.5, 5, time '21:30', 'Servicio del día'),
  ( 1, 'CONSUMO', 12.5, 3, time '21:30', 'Servicio del día'),
  ( 1, 'MERMA',   3.0,  2, time '10:00', 'Caducado, no se usó a tiempo'),
  ( 2, 'CONSUMO', 5.0,  1, time '15:30', 'Servicio de almuerzo'),
  -- Lapas (L20 viejo, L3 vigente)
  (20, 'CONSUMO', 12.0, 7, time '21:30', 'Servicio del día'),
  (20, 'CONSUMO', 11.5, 6, time '21:30', 'Servicio del día'),
  (20, 'MERMA',   1.5,  5, time '10:00', 'Caducadas sin usar'),
  ( 3, 'CONSUMO', 6.5,  1, time '15:30', 'Servicio de almuerzo'),
  -- Polvo (L19 viejo, L4 vigente)
  (19, 'CONSUMO', 9.5,  8, time '21:30', 'Servicio del día'),
  (19, 'CONSUMO', 9.5,  6, time '21:30', 'Servicio del día'),
  (19, 'MERMA',   1.0,  5, time '10:00', 'Mal olor, descartado'),
  ( 4, 'CONSUMO', 3.5,  1, time '21:30', 'Servicio del día'),
  ( 4, 'CONSUMO', 3.0,  1, time '15:30', 'Servicio de almuerzo'),
  -- Atum
  ( 5, 'CONSUMO', 2.2,  1, time '15:30', 'Servicio de almuerzo'),
  -- Camarão: consumo sostenido, queda ~1,2 kg
  ( 6, 'CONSUMO', 3.0, 22, time '21:30', 'Consumo semanal'),
  ( 6, 'CONSUMO', 2.8, 15, time '21:30', 'Consumo semanal'),
  ( 6, 'CONSUMO', 2.5,  8, time '21:30', 'Consumo semanal'),
  ( 6, 'CONSUMO', 2.5,  2, time '21:30', 'Consumo semanal'),
  -- Batata (L7 casi agotado, L8)
  ( 7, 'CONSUMO', 8.0, 10, time '21:30', 'Consumo semanal'),
  ( 7, 'CONSUMO', 7.5,  6, time '21:30', 'Consumo semanal'),
  ( 7, 'CONSUMO', 6.0,  4, time '21:30', 'Consumo semanal'),
  ( 7, 'MERMA',   1.5,  4, time '10:00', 'Brotadas'),
  ( 8, 'CONSUMO', 5.0,  1, time '21:30', 'Servicio del día'),
  -- Cebola
  ( 9, 'CONSUMO', 4.0,  7, time '21:30', 'Consumo semanal'),
  ( 9, 'CONSUMO', 3.5,  3, time '21:30', 'Consumo semanal'),
  -- Limão
  (10, 'CONSUMO', 3.5,  5, time '21:30', 'Consumo semanal'),
  -- Maracujá
  (11, 'CONSUMO', 1.2,  3, time '21:30', 'Postres y sumos'),
  (11, 'CONSUMO', 1.3,  1, time '21:30', 'Postres y sumos'),
  -- Alho
  (12, 'CONSUMO', 1.5,  8, time '21:30', 'Consumo quincenal'),
  -- Banana
  (13, 'CONSUMO', 3.4,  2, time '21:30', 'Postres'),
  (13, 'MERMA',   0.4,  1, time '10:00', 'Golpeadas en el transporte'),
  -- Azeite
  (14, 'CONSUMO', 4.0, 20, time '21:30', 'Consumo semanal'),
  (14, 'CONSUMO', 4.5, 10, time '21:30', 'Consumo semanal'),
  (14, 'CONSUMO', 3.5,  3, time '21:30', 'Consumo semanal'),
  -- Manteiga: queda 0,6 kg
  (15, 'CONSUMO', 1.5, 14, time '21:30', 'Consumo semanal'),
  (15, 'CONSUMO', 1.6,  7, time '21:30', 'Consumo semanal'),
  (15, 'CONSUMO', 1.3,  2, time '21:30', 'Consumo semanal'),
  -- Natas: consumo bajo frente a un pedido enorme
  (16, 'CONSUMO', 2.0, 10, time '21:30', 'Salsas'),
  (16, 'CONSUMO', 2.0,  4, time '21:30', 'Salsas'),
  -- Farinha de milho
  (18, 'CONSUMO', 3.0,  9, time '21:30', 'Milho frito')
) as m(lote_id, tipo, cantidad, dias, hora, motivo)
join public.lote l on l.id = m.lote_id;

-- Existencia de cada lote = inicial − consumos − mermas
update public.lote l
set cantidad_actual = l.cantidad_inicial - coalesce((
  select sum(mv.cantidad)
  from public.movimiento mv
  where mv.lote_id = l.id and mv.tipo in ('CONSUMO', 'MERMA')
), 0);

-- -----------------------------------------------------------------------------
-- Entregas (cumplimiento = a tiempo Y conforme)
--   Peixaria       6 entregas, 1 tarde        → 83 %
--   Hortofrutícola 5 entregas, todas bien     → 100 %
--   Atlântico      5 entregas, 2 tarde, 1 no conforme → 40 %  (R3)
--                  + 1 entrega pendiente
-- -----------------------------------------------------------------------------
insert into public.entrega (proveedor_id, fecha_esperada, fecha_real, conforme) values
  (1, current_date - 9,  current_date - 9,  true),
  (1, current_date - 8,  current_date - 8,  true),
  (1, current_date - 6,  current_date - 6,  true),
  (1, current_date - 4,  current_date - 3,  true),   -- tarde
  (1, current_date - 2,  current_date - 2,  true),
  (1, current_date - 1,  current_date - 1,  true),
  (2, current_date - 20, current_date - 20, true),
  (2, current_date - 12, current_date - 12, true),
  (2, current_date - 10, current_date - 10, true),
  (2, current_date - 8,  current_date - 8,  true),
  (2, current_date - 3,  current_date - 3,  true),
  (3, current_date - 28, current_date - 28, true),
  (3, current_date - 25, current_date - 23, true),   -- tarde
  (3, current_date - 22, current_date - 22, false),  -- no conforme (faltaron cajas)
  (3, current_date - 18, current_date - 16, true),   -- tarde
  (3, current_date - 2,  current_date - 2,  true),
  (3, current_date + 2,  null,              null);   -- pendiente

-- -----------------------------------------------------------------------------
-- Comandas — almuerzo tranquilo vs. cena saturada (horas locales de Madeira)
-- -----------------------------------------------------------------------------
insert into public.comanda (mesa, comensales, t_apertura, t_listo, t_cierre, usuario_id)
select c.mesa, c.comensales,
       (((current_date - c.dias) + c.apertura) at time zone 'Atlantic/Madeira'),
       (((current_date - c.dias) + c.apertura) at time zone 'Atlantic/Madeira') + make_interval(mins => c.min_listo),
       (((current_date - c.dias) + c.apertura) at time zone 'Atlantic/Madeira') + make_interval(mins => c.min_listo + c.min_cierre),
       null
from (values
  -- almuerzos (12:00–15:00): cocina ágil
  ('3',  2, 2, time '12:40', 14, 35),
  ('5',  4, 2, time '13:05', 18, 42),
  ('1',  2, 2, time '13:20', 15, 30),
  ('8',  6, 1, time '12:50', 22, 50),
  ('2',  3, 1, time '13:30', 16, 38),
  ('7',  2, 3, time '12:45', 13, 33),
  ('4',  4, 3, time '13:15', 17, 40),
  -- cenas (19:00–23:00): se dispara el tiempo hasta "listo"
  ('6',  4, 2, time '19:30', 25, 55),
  ('9',  8, 2, time '20:15', 41, 70),
  ('3',  2, 2, time '20:40', 38, 48),
  ('10', 5, 1, time '20:00', 44, 65),
  ('1',  2, 1, time '20:30', 47, 50),
  ('5',  6, 1, time '21:00', 52, 60),
  ('2',  2, 3, time '19:45', 28, 45),
  ('8',  4, 3, time '20:20', 39, 58)
) as c(mesa, comensales, dias, apertura, min_listo, min_cierre);

-- Dos mesas abiertas ahora mismo: la 11 lleva 70 min sin salir de cocina (R7)
-- y la 12 acaba de abrirse.
insert into public.comanda (mesa, comensales, t_apertura, usuario_id) values
  ('11', 4, now() - interval '70 minutes', null),
  ('12', 2, now() - interval '5 minutes',  null);
