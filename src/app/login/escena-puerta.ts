import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/**
 * Escena del login: el modelo 14 Neltume (de modelos-3d, con la madera cocida en texturas) en un muro con vano, con
 * sol de ventana y una sala tibia detrás. Al apuntar a «Ingresar» la hoja se entreabre; al ingresar se abre y la cámara
 * entra. Un solo bucle de render, en pausa si la pestaña no está visible. Devuelve la función que la desmonta.
 */
const v2 = (x: number, y: number) => new THREE.Vector2(x, y);

function estuco() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const d = g.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = 112 + Math.random() * 34;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

export async function montarEscena(lado: HTMLElement, login: HTMLElement, boton: HTMLElement, glb: ArrayBuffer): Promise<(() => void) | null> {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'gl-door';
  const etiquetas = new CSS2DRenderer();
  etiquetas.domElement.className = 'gl-labels';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#15241b');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;

  // Muro de estuco con el vano del marco (jambas exteriores a ±0,445 m, cabezal a 2,052 m).
  const forma = new THREE.Shape([v2(-4.5, -0.2), v2(4.5, -0.2), v2(4.5, 3.8), v2(-4.5, 3.8)]);
  forma.holes.push(new THREE.Path([v2(-0.445, -0.1), v2(-0.445, 2.052), v2(0.445, 2.052), v2(0.445, -0.1)]));
  const muro = new THREE.Mesh(
    new THREE.ExtrudeGeometry(forma, { depth: 0.089, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: '#2e4c3b', roughness: 0.94, bumpMap: estuco(), bumpScale: 0.35 }),
  );
  muro.position.z = -0.0445;
  muro.castShadow = muro.receiveShadow = true;
  scene.add(muro);
  // El piso de afuera llega hasta el umbral; adentro, la sala tiene su propio piso de madera.
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), new THREE.MeshStandardMaterial({ color: '#28312b', roughness: 0.78 }));
  piso.rotation.x = -Math.PI / 2;
  piso.position.z = 7.44;
  piso.receiveShadow = true;
  scene.add(piso);
  const zocalo = new THREE.MeshStandardMaterial({ color: '#33513f', roughness: 0.6 });
  for (const lado_ of [-1, 1]) {
    const z = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 0.014), zocalo);
    z.position.set(lado_ * 2.528, 0.05, 0.0515);
    z.castShadow = z.receiveShadow = true;
    scene.add(z);
  }
  const paredSala = new THREE.MeshStandardMaterial({ color: '#e6d3b2', roughness: 0.9, side: THREE.BackSide });
  const pisoSala = new THREE.MeshStandardMaterial({ color: '#a9845a', roughness: 0.6, side: THREE.BackSide });
  const sala = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.1, 3.2), [paredSala, paredSala, paredSala, pisoSala, paredSala, paredSala]);
  sala.position.set(0, 1.54, -1.66);
  sala.receiveShadow = true;
  scene.add(sala);

  // La puerta: girada para mirar el lado sin bisagras; así abre hacia adentro, lejos de la cámara.
  let gltf;
  try {
    gltf = await new GLTFLoader().parseAsync(glb, '');
  } catch {
    renderer.dispose();
    return null;
  }
  if (!lado.isConnected) {
    renderer.dispose();
    return null;
  }
  const puerta = new THREE.Group();
  puerta.add(gltf.scene);
  puerta.rotation.y = Math.PI;
  scene.add(puerta);
  gltf.scene.traverse((o) => {
    const malla = o as THREE.Mesh;
    if (!malla.isMesh) return;
    malla.castShadow = malla.receiveShadow = true;
    // El negro mate de Blender llega casi sin luz: un fierro oscuro con algo de reflejo se lee mejor en tiempo real.
    const m = malla.material as THREE.MeshStandardMaterial;
    if (m.name === 'Herraje_Negro_Mate') {
      m.metalness = 0.6;
      m.roughness = 0.34;
      m.color.set('#1d1c1a');
    }
  });
  const hoja = gltf.scene.getObjectByName('Hoja')!;
  const giro0 = hoja.rotation.y;

  scene.add(new THREE.HemisphereLight('#d3e4d8', '#22180f', 0.62));
  const sol = new THREE.DirectionalLight('#fff0dc', 2.5);
  sol.position.set(-2.6, 3.6, 3.2);
  sol.target.position.set(-0.35, 1.0, 0);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  Object.assign(sol.shadow.camera, { left: -3, right: 3, top: 3, bottom: -2, near: 0.5, far: 12 });
  sol.shadow.camera.updateProjectionMatrix();
  sol.shadow.bias = -0.0004;
  sol.shadow.normalBias = 0.02;
  scene.add(sol, sol.target);
  // Ventana fuera de cuadro: solo arroja sombra, para que el sol entre como un recuadro con palillos.
  const marcoV = new THREE.Shape([v2(-4, -4), v2(4, -4), v2(4, 4), v2(-4, 4)]);
  for (const [x, y] of [[-0.69, 0.06], [0.07, 0.06], [-0.69, -0.86], [0.07, -0.86]])
    marcoV.holes.push(new THREE.Path([v2(x, y), v2(x, y + 0.8), v2(x + 0.62, y + 0.8), v2(x + 0.62, y)]));
  const ventana = new THREE.Mesh(new THREE.ShapeGeometry(marcoV), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
  ventana.castShadow = true;
  const haciaSol = sol.position.clone().sub(sol.target.position).normalize();
  ventana.position.copy(sol.target.position).addScaledVector(haciaSol, 1.8);
  ventana.lookAt(sol.position);
  scene.add(ventana);
  const adentro = new THREE.SpotLight('#ffc98a', 38, 9, 0.75, 0.55, 1.6);
  adentro.position.set(0.35, 2.15, -1.5);
  adentro.target.position.set(-0.1, 0, 1.4);
  adentro.castShadow = true;
  adentro.shadow.mapSize.set(1024, 1024);
  adentro.shadow.bias = -0.0008;
  adentro.shadow.normalBias = 0.02;
  scene.add(adentro, adentro.target);
  const salaLuz = new THREE.PointLight('#ffd7a0', 5, 2.6, 1.5);
  salaLuz.position.set(0, 2.3, -1.9);
  scene.add(salaLuz);

  // Cotas de la hoja, como en un plano.
  const tinta = new THREE.LineBasicMaterial({ color: '#efe6d2', transparent: true, opacity: 0.45 });
  const zc = 0.075, yw = 2.22, xh = 0.7, t = 0.035;
  const pts = [[-0.4, yw], [0.4, yw], [-0.4, yw - t], [-0.4, yw + t], [0.4, yw - t], [0.4, yw + t], [xh, 0.008], [xh, 2.008], [xh - t, 0.008], [xh + t, 0.008], [xh - t, 2.008], [xh + t, 2.008]].map(([x, y]) => new THREE.Vector3(x, y, zc));
  const cotas = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), tinta);
  scene.add(cotas);
  const etiqueta = (txt: string, x: number, y: number, cls: string) => {
    const el = document.createElement('span');
    el.className = `dim3d ${cls}`;
    const interior = document.createElement('span');
    interior.textContent = txt;
    el.append(interior);
    const o = new CSS2DObject(el);
    o.position.set(x, y, zc);
    scene.add(o);
  };
  etiqueta('0,80 m', 0, yw + 0.075, 'w');
  etiqueta('2,00 m', xh, 1.008, 'h');

  const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
  const base = new THREE.Vector3();
  const mira = new THREE.Vector3();
  function encuadre() {
    const w = lado.clientWidth, h = lado.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    etiquetas.setSize(w, h);
    cam.aspect = w / h;
    if (cam.aspect > 1.05) {
      cam.fov = 30;
      base.set(0.75, 1.2, 5.4);
      mira.set(-0.95, 1.0, 0);
      etiquetas.domElement.style.display = 'none';
      cotas.visible = false;
    } else {
      cam.fov = 36;
      base.set(1.0, 1.38, 5.0);
      mira.set(-0.24, 1.2, 0);
      etiquetas.domElement.style.display = '';
      cotas.visible = true;
    }
    cam.updateProjectionMatrix();
  }
  const capa = lado.querySelector('.door-cap');
  lado.insertBefore(canvas, capa);
  lado.insertBefore(etiquetas.domElement, capa);
  const ro = new ResizeObserver(encuadre);
  ro.observe(lado);
  encuadre();

  let tx = 0, ty = 0, px = 0, py = 0, apunta = false, ang = 0, entra = 0, ultimo = performance.now(), primero = true;
  const mover = (e: PointerEvent) => {
    const r = login.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    ty = ((e.clientY - r.top) / r.height) * 2 - 1;
  };
  const si = () => {
    apunta = true;
  };
  const no = () => {
    apunta = false;
  };
  login.addEventListener('pointermove', mover);
  boton.addEventListener('pointerenter', si);
  boton.addEventListener('pointerleave', no);
  boton.addEventListener('focus', si);
  boton.addEventListener('blur', no);
  const suave = (v: number, meta: number, dt: number, k: number) => v + (meta - v) * (1 - Math.exp(-dt * k));
  function cuadro(ahora: number) {
    const dt = Math.min(0.05, (ahora - ultimo) / 1000);
    ultimo = ahora;
    const entrando = login.classList.contains('entrando');
    ang = suave(ang, entrando ? 1.45 : apunta ? 0.5 : 0, dt, entrando ? 2.6 : 3.4);
    entra = suave(entra, entrando ? 1 : 0, dt, 1.9);
    px = suave(px, tx, dt, 2.5);
    py = suave(py, ty, dt, 2.5);
    hoja.rotation.y = giro0 + ang;
    cam.position.set(base.x + px * 0.28 - entra * (base.x - 0.05), base.y - py * 0.1 - entra * 0.08, base.z - entra * 3.3);
    cam.lookAt(mira.x * (1 - entra), mira.y, mira.z);
    sol.position.x = -2.6 + Math.sin(ahora / 9000) * 0.08;
    renderer.render(scene, cam);
    etiquetas.render(scene, cam);
    if (primero) {
      primero = false;
      requestAnimationFrame(() => lado.classList.add('gl-listo'));
    }
  }
  const visible = () => renderer.setAnimationLoop(document.hidden ? null : cuadro);
  document.addEventListener('visibilitychange', visible);
  visible();

  return () => {
    renderer.setAnimationLoop(null);
    document.removeEventListener('visibilitychange', visible);
    ro.disconnect();
    login.removeEventListener('pointermove', mover);
    boton.removeEventListener('pointerenter', si);
    boton.removeEventListener('pointerleave', no);
    boton.removeEventListener('focus', si);
    boton.removeEventListener('blur', no);
    scene.traverse((o) => {
      const malla = o as THREE.Mesh;
      malla.geometry?.dispose();
      for (const m of ([] as THREE.Material[]).concat(malla.material || [])) {
        for (const k of Object.keys(m)) {
          const valor = (m as unknown as Record<string, unknown>)[k];
          if ((valor as THREE.Texture | undefined)?.isTexture) (valor as THREE.Texture).dispose();
        }
        m.dispose();
      }
    });
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    etiquetas.domElement.remove();
    lado.classList.remove('gl-listo');
  };
}
