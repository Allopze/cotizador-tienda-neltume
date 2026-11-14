import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { clienteVacio } from '../src/catalogo/tipos';
import { digitoVerificador } from '../src/negocio/cliente';
import { REGLAS, montosVacios } from '../src/negocio/precios';
import { Almacen } from '../src/servidor/almacen';
import { auditoriaDeCliente, obtenerCliente } from '../src/servidor/repositorio-clientes';
import { montarInstalacion } from './sesion-prueba';

const rut = (cuerpo: string) => `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${digitoVerificador(cuerpo)}`;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.();
  desmontar = undefined;
});

async function montar() {
  const instalacion = await montarInstalacion('repo-clientes');
  desmontar = instalacion.desmontar;
  const admin = await instalacion.cuenta('admin@neltume.test', 'admin', 'Encargada');
  const vendedora = await instalacion.cuenta('ventas@neltume.test', 'user', 'Vendedora');
  const ruta = await import('../src/app/api/clientes/route');
  return { ...instalacion, admin, vendedora, ruta };
}

describe('repositorio y API /api/clientes (CRUD, roles, RUT único y auditoría)', () => {
  it('exige sesión en GET/POST/PATCH/DELETE y restringe DELETE a cuentas administradoras', async () => {
    const { vendedora, admin, ruta, peticion } = await montar();

    expect((await ruta.GET(peticion('/api/clientes?q=lingue'))).status).toBe(401);
    expect((await ruta.POST(peticion('/api/clientes', { json: { nombre: 'Sin sesión' } }))).status).toBe(401);

    // Usuario normal puede crear y editar clientes frecuentes.
    const crearRes = await ruta.POST(
      peticion('/api/clientes', {
        cookie: vendedora.cookie,
        json: {
          nombre: 'Constructora Lingue',
          rut: rut('76543210'),
          giro: 'Construcción',
          telefono: '+56 9 5555 1111',
          direccion: 'Av. Alemania 450',
          comuna: 'Temuco',
          correo: 'contacto@lingue.cl',
          notas: 'Compra mensual de puertas.',
          documentoHabitual: 'factura',
          receptorFacturacion: {
            razonSocial: 'Constructora Lingue SpA',
            rut: rut('76543210'),
            giro: 'Obras menores',
            direccion: 'Av. Alemania 450',
            comuna: 'Temuco',
            correo: 'facturas@lingue.cl',
          },
        },
      }),
    );
    expect(crearRes.status).toBe(201);
    const { cliente: creado } = await crearRes.json();
    expect(creado.rut).toBe(rut('76543210'));
    expect(creado.documentoHabitual).toBe('factura');
    expect(creado.creadoPor).toBe('ventas@neltume.test');

    const editarRes = await ruta.PATCH(
      peticion('/api/clientes', {
        cookie: vendedora.cookie,
        metodo: 'PATCH',
        json: {
          id: creado.id,
          actualizado: creado.actualizado,
          nombre: 'Constructora Lingue Sur',
          rut: creado.rut,
          correo: 'nuevo@lingue.cl',
        },
      }),
    );
    expect(editarRes.status).toBe(200);
    const { cliente: editado } = await editarRes.json();
    expect(editado.nombre).toBe('Constructora Lingue Sur');
    expect(editado.correo).toBe('nuevo@lingue.cl');
    expect(editado.actualizadoPor).toBe('ventas@neltume.test');

    // Baja lógica rechazada para cuenta estándar (403).
    const borrarVendedora = await ruta.DELETE(
      peticion('/api/clientes', {
        cookie: vendedora.cookie,
        metodo: 'DELETE',
        json: { id: creado.id, actualizado: editado.actualizado },
      }),
    );
    expect(borrarVendedora.status).toBe(403);

    // Administrador puede dar de baja lógica.
    const borrarAdmin = await ruta.DELETE(
      peticion('/api/clientes', {
        cookie: admin.cookie,
        metodo: 'DELETE',
        json: { id: creado.id, actualizado: editado.actualizado },
      }),
    );
    expect(borrarAdmin.status).toBe(200);
  });

  it('valida RUT módulo 11, correo, concurrencia optimista y rechaza RUT duplicado devolviendo clienteExistente', async () => {
    const { vendedora, ruta, peticion } = await montar();
    const rutLingue = rut('76123456');

    const invalidoRut = await ruta.POST(
      peticion('/api/clientes', { cookie: vendedora.cookie, json: { nombre: 'Cliente X', rut: '12.345.678-0' } }),
    );
    expect(invalidoRut.status).toBe(400);
    expect((await invalidoRut.json()).codigo).toBe('rut_invalido');

    const invalidoCorreo = await ruta.POST(
      peticion('/api/clientes', { cookie: vendedora.cookie, json: { nombre: 'Cliente X', correo: 'correo-malo' } }),
    );
    expect(invalidoCorreo.status).toBe(400);

    const primero = await ruta.POST(
      peticion('/api/clientes', { cookie: vendedora.cookie, json: { nombre: 'Lingue Uno', rut: rutLingue } }),
    );
    expect(primero.status).toBe(201);
    const { cliente: c1 } = await primero.json();

    // Duplicado con formato distinto sin puntos ni guion.
    const duplicado = await ruta.POST(
      peticion('/api/clientes', {
        cookie: vendedora.cookie,
        json: { nombre: 'Otra Constructora', rut: rutLingue.replace(/[.-]/g, '').toLowerCase() },
      }),
    );
    expect(duplicado.status).toBe(409);
    const bodyDup = await duplicado.json();
    expect(bodyDup.codigo).toBe('rut_duplicado');
    expect(bodyDup.detalle.clienteExistente.id).toBe(c1.id);
    expect(bodyDup.detalle.clienteExistente.nombre).toBe('Lingue Uno');

    // Concurrencia optimista en PATCH.
    const rEd1 = await ruta.PATCH(
      peticion('/api/clientes', {
        cookie: vendedora.cookie,
        metodo: 'PATCH',
        json: { id: c1.id, actualizado: c1.actualizado, nombre: 'Lingue Actualizado', rut: rutLingue },
      }),
    );
    expect(rEd1.status).toBe(200);
    const rEdStale = await ruta.PATCH(
      peticion('/api/clientes', {
        cookie: vendedora.cookie,
        metodo: 'PATCH',
        json: { id: c1.id, actualizado: c1.actualizado, nombre: 'Lingue Viejo', rut: rutLingue },
      }),
    );
    expect(rEdStale.status).toBe(409);
    expect((await rEdStale.json()).codigo).toBe('version_obsoleta');
  });

  it('registra auditoría antes→después, permite reutilizar RUT tras baja lógica y no altera cotizaciones previas', async () => {
    const { directorio, admin, vendedora, ruta, peticion, db } = await montar();
    const rutCliente = rut('77665544');

    // Cotización existente con nombre/RUT propio.
    const almacen = new Almacen(directorio);
    const fecha = '2026-11-13T10:00:00.000Z';
    const qId = randomUUID();
    await almacen.transaccion((u) => {
      u.guardar({
        id: qId,
        numero: 701,
        estado: 'emitida',
        cliente: { ...clienteVacio(), nombre: 'Mueblería Antiguo', rut: rutCliente },
        solicitudes: [],
        montos: montosVacios(),
        incompletos: [],
        historial: [],
        creada: fecha,
        actualizada: fecha,
        pdf: null,
        fechaEmision: fecha,
        fechaAprobacion: null,
        vence: null,
        descuento: 0,
        flete: 0,
        margenCotizacion: null,
        observaciones: null,
        despacho: null,
        reglas: { ...REGLAS },
        creadaPor: 'Ana',
        emitidaPor: 'Ana',
        aprobadaPor: null,
        anuladaPor: null,
        fechaAnulacion: null,
        motivoAnulacion: null,
        reemplazadaPor: null,
        versionCatalogo: null,
        notas: [],
        estadoOperativo: 'sin_pedido',
        pagos: [],
        comentariosInternos: [],
        facturacion: {
          estado: 'pendiente',
          documento: null,
          receptor: null,
          tipo: null,
          identificadorExterno: null,
          fecha: null,
        },
      });
    });

    const cRes = await ruta.POST(
      peticion('/api/clientes', {
        cookie: vendedora.cookie,
        json: { nombre: 'Mueblería Neltume', rut: rutCliente, correo: 'ventas@muebleria.cl' },
      }),
    );
    const { cliente } = await cRes.json();

    await ruta.PATCH(
      peticion('/api/clientes', {
        cookie: admin.cookie,
        metodo: 'PATCH',
        json: {
          id: cliente.id,
          actualizado: cliente.actualizado,
          nombre: 'Mueblería Neltume Ltda.',
          rut: rutCliente,
          correo: 'facturas@muebleria.cl',
          documentoHabitual: 'boleta',
        },
      }),
    );

    const borrado = await ruta.DELETE(
      peticion('/api/clientes', {
        cookie: admin.cookie,
        metodo: 'DELETE',
        json: { id: cliente.id },
      }),
    );
    expect(borrado.status).toBe(200);

    // La baja es lógica y conserva la auditoría completa; la cotización antigua no cambia.
    expect(obtenerCliente(db, cliente.id)).toBeNull();
    expect(obtenerCliente(db, cliente.id, { incluirEliminados: true })).not.toBeNull();
    expect(almacen.obtener(qId)?.cliente.nombre).toBe('Mueblería Antiguo');

    const historial = auditoriaDeCliente(db, cliente.id);
    expect(historial.map((h) => h.accion)).toEqual(['eliminar', 'editar', 'crear']);
    expect(historial[1].actor).toBe('admin@neltume.test');
    expect(historial[1].detalle).toContain('Mueblería Neltume → Mueblería Neltume Ltda.');
    expect(historial[1].detalle).toContain('ventas@muebleria.cl → facturas@muebleria.cl');
    expect(JSON.parse(historial[1].antesJson!).nombre).toBe('Mueblería Neltume');
    expect(JSON.parse(historial[1].despuesJson!).nombre).toBe('Mueblería Neltume Ltda.');

    // Tras baja lógica, ?rut= ya no encuentra el eliminado y se puede volver a registrar ese RUT.
    const lookupRes = await ruta.GET(
      peticion(`/api/clientes?rut=${encodeURIComponent(rutCliente)}`, { cookie: vendedora.cookie }),
    );
    expect((await lookupRes.json()).cliente).toBeNull();

    const recreadoRes = await ruta.POST(
      peticion('/api/clientes', {
        cookie: vendedora.cookie,
        json: { nombre: 'Mueblería Renovada', rut: rutCliente },
      }),
    );
    expect(recreadoRes.status).toBe(201);
  });

  it('guardar sin cambios no escribe ni audita, y editar o dar de baja exige la versión de la ficha', async () => {
    const { vendedora, admin, ruta, peticion, db } = await montar();
    const datos = { nombre: 'Maderas Ranco', rut: rut('77111222'), giro: 'Comercio', comuna: 'Futrono' };
    const { cliente } = await (
      await ruta.POST(peticion('/api/clientes', { cookie: vendedora.cookie, json: datos }))
    ).json();

    // Mismos datos: responde la ficha tal cual, sin nueva versión ni fila de auditoría.
    const igual = await ruta.PATCH(
      peticion('/api/clientes', {
        cookie: vendedora.cookie,
        metodo: 'PATCH',
        json: { id: cliente.id, actualizado: cliente.actualizado, ...datos },
      }),
    );
    expect(igual.status).toBe(200);
    expect((await igual.json()).cliente.actualizado).toBe(cliente.actualizado);
    expect(auditoriaDeCliente(db, cliente.id)).toHaveLength(1);

    // Sin `actualizado` no se edita ni se da de baja: evita pisar cambios de otra persona.
    const sinVersion = await ruta.PATCH(
      peticion('/api/clientes', { cookie: vendedora.cookie, metodo: 'PATCH', json: { id: cliente.id, ...datos } }),
    );
    expect(sinVersion.status).toBe(400);
    const bajaSinVersion = await ruta.DELETE(
      peticion('/api/clientes', { cookie: admin.cookie, metodo: 'DELETE', json: { id: cliente.id } }),
    );
    expect(bajaSinVersion.status).toBe(400);
    expect(obtenerCliente(db, cliente.id)).not.toBeNull();
  });
});
