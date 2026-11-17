import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARCHIVO_APK, leerVersionApp } from '../src/servidor/app-movil';

// Versión publicada de la app de Android: se lee de <NELTUME_DATA_DIR>/app/ (version.json y el APK).
describe('versión publicada de la app de Android', () => {
  let dir: string;
  const anterior = process.env.NELTUME_DATA_DIR;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'neltume-app-'));
    process.env.NELTUME_DATA_DIR = dir;
  });
  afterEach(async () => {
    process.env.NELTUME_DATA_DIR = anterior;
    await rm(dir, { recursive: true, force: true });
  });
  const publicar = async (version: unknown, apk: string | null = 'apk') => {
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(join(dir, 'app', 'version.json'), JSON.stringify(version));
    if (apk !== null) await writeFile(join(dir, 'app', ARCHIVO_APK), apk);
  };
  const valida = { versionCode: 3, versionName: '1.2.0', sha256: 'a'.repeat(64), minimo: 2, notas: 'Mejoras' };

  it('sin carpeta no hay versión', async () => {
    expect(await leerVersionApp()).toBeNull();
  });
  it('lee la versión y el tamaño del APK', async () => {
    await publicar(valida, '12345');
    expect(await leerVersionApp()).toEqual({ ...valida, tamano: 5 });
  });
  it('sin el APK no hay versión, aunque esté el JSON', async () => {
    await publicar(valida, null);
    expect(await leerVersionApp()).toBeNull();
  });
  it('rechaza un JSON incompleto o con campos de más', async () => {
    await publicar({ versionCode: 3, versionName: '1.2.0' });
    expect(await leerVersionApp()).toBeNull();
    await publicar({ ...valida, sha256: 'xyz' });
    expect(await leerVersionApp()).toBeNull();
    await publicar({ ...valida, url: 'https://otro' });
    expect(await leerVersionApp()).toBeNull();
  });
});
